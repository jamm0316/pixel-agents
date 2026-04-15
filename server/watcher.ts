import chokidar from 'chokidar';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { loadSquad } from './agents-loader.ts';
import type { SessionInfo, StreamEvent } from './types.ts';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const ACTIVE_WINDOW_MS = 5 * 60_000;
const SUBAGENT_IDLE_MS = 30_000;

type FileKind = 'main' | 'subagent';

type FileState = {
  offset: number;
  carry: string;
  kind: FileKind;
  // For 'main': the session id; for 'subagent': the parent session id
  parentSessionId: string;
  // For 'subagent': the agent display name from meta.json
  subagentName?: string;
  subagentId?: string;
  toolUseIdMap: Map<string, { agentName: string; tool: string }>;
  lastEventAt: number;
  stopEmitted?: boolean;
};

type SessionState = {
  info: SessionInfo;
  opened: boolean;
};

function tryStat(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function parseTime(ts?: string): number {
  if (!ts) return Date.now();
  const t = Date.parse(ts);
  return isNaN(t) ? Date.now() : t;
}

function summarizeInput(tool: string, input: any): string {
  if (!input) return '';
  try {
    if (tool === 'Read' || tool === 'Write' || tool === 'Edit') return String(input.file_path ?? '');
    if (tool === 'Bash') return String(input.command ?? '').slice(0, 140);
    if (tool === 'Grep') return String(input.pattern ?? '');
    if (tool === 'Glob') return String(input.pattern ?? '');
    if (tool === 'Task' || tool === 'Agent') {
      const sub = input.subagent_type ?? 'sub';
      const desc = input.description ?? input.prompt ?? '';
      return `${sub}: ${String(desc).slice(0, 120)}`;
    }
    if (tool === 'WebFetch') return String(input.url ?? '');
    if (tool === 'WebSearch') return String(input.query ?? '');
    const j = JSON.stringify(input);
    return j.length > 140 ? j.slice(0, 140) + '…' : j;
  } catch {
    return '';
  }
}

// Subagent file path:
//   ~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<aid>.jsonl
// Main session file path:
//   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
function mainFilePathFromSubagent(subFilePath: string): string | null {
  const parts = subFilePath.split('/');
  const subIdx = parts.indexOf('subagents');
  if (subIdx <= 0) return null;
  const sessionId = parts[subIdx - 1];
  const encodedCwd = parts.slice(0, subIdx - 1).join('/');
  return `${encodedCwd}/${sessionId}.jsonl`;
}

function classifyFile(filePath: string): {
  kind: FileKind;
  parentSessionId: string;
  subagentId?: string;
} | null {
  const parts = filePath.split('/');
  const projIdx = parts.indexOf('projects');
  if (projIdx < 0) return null;
  const subIdx = parts.indexOf('subagents');
  if (subIdx > 0) {
    const parentSessionId = parts[subIdx - 1];
    const fname = parts[parts.length - 1];
    if (!fname.startsWith('agent-') || !fname.endsWith('.jsonl')) return null;
    const subagentId = fname.slice('agent-'.length, -'.jsonl'.length);
    return { kind: 'subagent', parentSessionId, subagentId };
  }
  // Main: filename pattern <uuid>.jsonl directly under encoded-cwd
  // Encoded-cwd is at projIdx+1, filename at projIdx+2
  if (parts.length === projIdx + 3) {
    const fname = parts[parts.length - 1];
    if (!fname.endsWith('.jsonl')) return null;
    const parentSessionId = fname.slice(0, -'.jsonl'.length);
    return { kind: 'main', parentSessionId };
  }
  return null;
}

function readSubagentMeta(jsonlPath: string): { agentType: string; description?: string } | null {
  const metaPath = jsonlPath.slice(0, -'.jsonl'.length) + '.meta.json';
  try {
    const raw = readFileSync(metaPath, 'utf8');
    const j = JSON.parse(raw);
    return { agentType: j.agentType, description: j.description };
  } catch {
    return null;
  }
}

function deriveCwdFromMainPath(filePath: string): string | null {
  // Encoded path: -Users-<user>-... → /Users/<user>/...
  // It's NOT 1:1 reversible because actual paths can contain '-'. The transcript file
  // itself stores cwd in its content, so we prefer that. This is a fallback.
  const parts = filePath.split('/');
  const projIdx = parts.indexOf('projects');
  if (projIdx < 0 || projIdx + 1 >= parts.length) return null;
  const enc = parts[projIdx + 1];
  if (!enc.startsWith('-')) return null;
  return enc.slice(1).replace(/-/g, '/');
}

export class TranscriptWatcher extends EventEmitter {
  private files = new Map<string, FileState>();
  private sessions = new Map<string, SessionState>();

  async start() {
    const w = chokidar.watch(PROJECTS_DIR, {
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: false,
      depth: 4,
    });
    const isJsonl = (p: string) => p.endsWith('.jsonl');
    w.on('add', (p) => {
      if (isJsonl(p)) this.handleFile(p, false).catch(() => {});
    });
    w.on('change', (p) => {
      if (isJsonl(p)) this.handleFile(p, true).catch(() => {});
    });
    w.on('unlink', (p) => {
      if (isJsonl(p)) this.files.delete(p);
    });
    setInterval(() => this.sweepStale(), 5_000).unref?.();
  }

  private sweepStale() {
    const now = Date.now();
    // Close stale sessions
    for (const [sessionId, sess] of this.sessions) {
      if (!sess.opened) continue;
      if (now - sess.info.updatedAt > ACTIVE_WINDOW_MS) {
        this.sessions.delete(sessionId);
        this.emit('event', { kind: 'session-close', sessionId } as StreamEvent);
      }
    }
    // Mark idle subagents as stopped
    for (const [path, fs_] of this.files) {
      if (fs_.kind !== 'subagent' || fs_.stopEmitted) continue;
      if (now - fs_.lastEventAt > SUBAGENT_IDLE_MS && fs_.subagentName) {
        fs_.stopEmitted = true;
        this.emit('event', {
          kind: 'agent-stop',
          sessionId: fs_.parentSessionId,
          agentName: fs_.subagentName,
          timestamp: now,
        } as StreamEvent);
      }
    }
  }

  getSnapshot(): SessionInfo[] {
    return [...this.sessions.values()]
      .filter((s) => s.opened)
      .map((s) => s.info);
  }

  getActiveSubagent(sessionId: string): string | null {
    // Best-effort: most recent live subagent for a session
    for (const fs_ of this.files.values()) {
      if (
        fs_.kind === 'subagent' &&
        fs_.parentSessionId === sessionId &&
        !fs_.stopEmitted &&
        fs_.subagentName
      ) {
        return fs_.subagentName;
      }
    }
    return null;
  }

  private async handleFile(filePath: string, isChange: boolean) {
    const stat = tryStat(filePath);
    if (!stat) return;

    const cls = classifyFile(filePath);
    if (!cls) return;

    let fs_ = this.files.get(filePath);
    if (!fs_) {
      // For subagent files, liveness is driven by the parent main session, not the
      // subagent's own mtime — a finished subagent has a frozen mtime but its parent
      // session may still be active, and we want those subagents to show up.
      let ageRef = stat.mtimeMs;
      if (cls.kind === 'subagent') {
        const mainPath = mainFilePathFromSubagent(filePath);
        const mainStat = mainPath ? tryStat(mainPath) : null;
        if (mainStat) ageRef = mainStat.mtimeMs;
      }
      const age = Date.now() - ageRef;
      if (age > ACTIVE_WINDOW_MS && !isChange) {
        // Stale: register but skip content
        this.files.set(filePath, {
          offset: stat.size,
          carry: '',
          kind: cls.kind,
          parentSessionId: cls.parentSessionId,
          subagentId: cls.subagentId,
          toolUseIdMap: new Map(),
          lastEventAt: stat.mtimeMs,
        });
        return;
      }

      fs_ = {
        offset: 0,
        carry: '',
        kind: cls.kind,
        parentSessionId: cls.parentSessionId,
        subagentId: cls.subagentId,
        toolUseIdMap: new Map(),
        lastEventAt: stat.mtimeMs,
      };
      this.files.set(filePath, fs_);

      // For subagent files: read meta + emit agent-start (if parent session exists)
      if (cls.kind === 'subagent') {
        const meta = readSubagentMeta(filePath);
        const agentName = meta?.agentType ?? 'subagent';
        fs_.subagentName = agentName;
        // Wait until parent session exists (it should already by now if active)
        const parent = this.sessions.get(cls.parentSessionId);
        if (parent && parent.opened) {
          this.emit('event', {
            kind: 'agent-start',
            sessionId: cls.parentSessionId,
            agentName,
            tool: 'Agent',
            inputSummary: meta?.description ?? '',
            toolCallId: `sub-${cls.subagentId}`,
            timestamp: stat.mtimeMs,
          } as StreamEvent);
        }
      }
    }

    if (stat.size <= fs_.offset) return;

    const stream = createReadStream(filePath, {
      start: fs_.offset,
      end: stat.size - 1,
      encoding: 'utf8',
    });
    let buf = fs_.carry;
    for await (const chunk of stream) buf += chunk as string;
    fs_.offset = stat.size;
    const lines = buf.split('\n');
    fs_.carry = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        await this.processEvent(filePath, fs_, JSON.parse(line));
      } catch {}
    }
    fs_.lastEventAt = Date.now();
  }

  private async ensureSession(sessionId: string, cwd: string, emitOpen: boolean): Promise<SessionState> {
    let s = this.sessions.get(sessionId);
    if (s) {
      if (emitOpen && !s.opened) {
        s.opened = true;
        this.emit('event', { kind: 'session-open', session: s.info } as StreamEvent);
      }
      return s;
    }
    const squad = await loadSquad(cwd);
    const info: SessionInfo = {
      sessionId,
      cwd,
      projectName: basename(cwd) || cwd,
      squad,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    s = { info, opened: emitOpen };
    this.sessions.set(sessionId, s);
    if (emitOpen) {
      this.emit('event', { kind: 'session-open', session: info } as StreamEvent);
    }
    return s;
  }

  private async processEvent(filePath: string, fs_: FileState, evt: any) {
    const sessionId = fs_.parentSessionId;
    const cwd: string | undefined = evt.cwd;

    // Ensure parent session exists (main file always carries cwd; subagent file usually does too)
    let sess = this.sessions.get(sessionId);
    if (!sess && cwd) {
      sess = await this.ensureSession(sessionId, cwd, true);
    }
    if (!sess) return;
    if (!sess.opened) {
      sess.opened = true;
      this.emit('event', { kind: 'session-open', session: sess.info } as StreamEvent);
    }
    sess.info.updatedAt = parseTime(evt.timestamp);

    // For subagent files the agentName is fixed by meta; for main files it's 'main'
    const fileAgentName = fs_.kind === 'subagent' ? fs_.subagentName ?? 'subagent' : 'main';

    if (evt.type === 'assistant' && evt.message?.content) {
      for (const part of evt.message.content) {
        if (part?.type !== 'tool_use') continue;
        const tool: string = part.name;
        const toolUseId: string = part.id;
        const inputSummary = summarizeInput(tool, part.input);
        const ts = parseTime(evt.timestamp);

        if (fs_.kind === 'main' && (tool === 'Task' || tool === 'Agent')) {
          // Main is invoking a subagent. The subagent file itself will emit agent-start
          // (driven by the file watcher). But we still record the call as a main tool use
          // for history purposes.
          fs_.toolUseIdMap.set(toolUseId, { agentName: 'main', tool });
          this.emit('event', {
            kind: 'agent-tool',
            sessionId,
            agentName: 'main',
            tool,
            inputSummary,
            toolCallId: toolUseId,
            timestamp: ts,
          } as StreamEvent);
        } else {
          fs_.toolUseIdMap.set(toolUseId, { agentName: fileAgentName, tool });
          this.emit('event', {
            kind: 'agent-tool',
            sessionId,
            agentName: fileAgentName,
            tool,
            inputSummary,
            toolCallId: toolUseId,
            timestamp: ts,
          } as StreamEvent);
        }
      }
    }

    if (evt.type === 'user' && Array.isArray(evt.message?.content)) {
      for (const part of evt.message.content) {
        if (part?.type !== 'tool_result') continue;
        const toolUseId = part.tool_use_id;
        const meta = fs_.toolUseIdMap.get(toolUseId);
        if (!meta) continue;
        fs_.toolUseIdMap.delete(toolUseId);
        const status = part.is_error ? 'error' : 'done';
        const ts = parseTime(evt.timestamp);
        this.emit('event', {
          kind: 'agent-tool-end',
          sessionId,
          agentName: meta.agentName,
          toolCallId: toolUseId,
          status,
          timestamp: ts,
        } as StreamEvent);
      }
    }
  }
}
