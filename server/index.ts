import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { TranscriptWatcher } from './watcher.ts';
import type { StreamEvent, PermissionRequest } from './types.ts';

const watcher = new TranscriptWatcher();
await watcher.start();

const subscribers = new Set<(e: StreamEvent) => void>();
function broadcast(e: StreamEvent) {
  for (const fn of subscribers) fn(e);
}
watcher.on('event', (e: StreamEvent) => broadcast(e));

// ---------- Permission gate state ----------

type Pending = {
  req: PermissionRequest;
  resolve: (decision: 'allow' | 'deny' | 'ask') => void;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<string, Pending>();

// Per-session always-accept map: sessionId -> Set<tool>
const alwaysAccept = new Map<string, Set<string>>();
function isAlwaysAccepted(sessionId: string, tool: string): boolean {
  return alwaysAccept.get(sessionId)?.has(tool) ?? false;
}
function addAlwaysAccept(sessionId: string, tool: string) {
  let s = alwaysAccept.get(sessionId);
  if (!s) {
    s = new Set();
    alwaysAccept.set(sessionId, s);
  }
  s.add(tool);
}

function summarizeHookInput(tool: string, input: any): string {
  if (!input) return '';
  try {
    if (tool === 'Read' || tool === 'Write' || tool === 'Edit') return String(input.file_path ?? '');
    if (tool === 'Bash') return String(input.command ?? '').slice(0, 160);
    if (tool === 'Grep' || tool === 'Glob') return String(input.pattern ?? '');
    if (tool === 'Task' || tool === 'Agent') {
      const sub = input.subagent_type ?? 'sub';
      const desc = input.description ?? input.prompt ?? '';
      return `${sub}: ${String(desc).slice(0, 120)}`;
    }
    if (tool === 'WebFetch') return String(input.url ?? '');
    if (tool === 'WebSearch') return String(input.query ?? '');
    const j = JSON.stringify(input);
    return j.length > 160 ? j.slice(0, 160) + '…' : j;
  } catch {
    return '';
  }
}

function getPendingList(): PermissionRequest[] {
  return [...pending.values()].map((p) => p.req);
}

// ---------- HTTP app ----------

const app = new Hono();
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  })
);

app.get('/api/sessions', (c) => c.json(watcher.getSnapshot()));
app.get('/api/ping', (c) => c.json({ ok: true, t: Date.now() }));
app.get('/api/pending', (c) => c.json(getPendingList()));

// Hook POST: blocks until web UI resolves (or 9-minute timeout)
app.post('/api/permission-request', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ decision: 'ask' });
  const { sessionId, tool, input, requestId } = body;
  if (!sessionId || !tool || !requestId) return c.json({ decision: 'ask' });

  if (isAlwaysAccepted(sessionId, tool)) {
    return c.json({ decision: 'allow' });
  }

  const agentName = watcher.getActiveSubagent(sessionId) ?? 'main';
  const req: PermissionRequest = {
    requestId,
    sessionId,
    agentName,
    tool,
    inputSummary: summarizeHookInput(tool, input),
    createdAt: Date.now(),
  };

  const decision = await new Promise<'allow' | 'deny' | 'ask'>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      broadcast({ kind: 'permission-resolved', requestId, decision: 'deny' });
      resolve('ask');
    }, 9 * 60_000);
    pending.set(requestId, { req, resolve, timer });
    broadcast({ kind: 'permission-request', req });
  });

  return c.json({ decision });
});

// Web UI POST: {requestId, decision: 'allow' | 'deny' | 'always'}
app.post('/api/permission-response', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ ok: false }, 400);
  const { requestId, decision } = body as { requestId: string; decision: string };
  const p = pending.get(requestId);
  if (!p) return c.json({ ok: false, error: 'not-found' }, 404);

  let final: 'allow' | 'deny' = 'allow';
  if (decision === 'deny') final = 'deny';
  else if (decision === 'always') {
    addAlwaysAccept(p.req.sessionId, p.req.tool);
    final = 'allow';
  } else final = 'allow';

  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(final);
  broadcast({ kind: 'permission-resolved', requestId, decision: final });
  return c.json({ ok: true });
});

app.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const snapshot: StreamEvent = {
      kind: 'snapshot',
      sessions: watcher.getSnapshot(),
      pending: getPendingList(),
    };
    await stream.writeSSE({ data: JSON.stringify(snapshot) });

    const queue: StreamEvent[] = [];
    let resolver: (() => void) | null = null;
    const push = (e: StreamEvent) => {
      queue.push(e);
      resolver?.();
    };
    subscribers.add(push);

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => (resolver = r));
          resolver = null;
        }
        while (queue.length) {
          const evt = queue.shift()!;
          await stream.writeSSE({ data: JSON.stringify(evt) });
        }
      }
    } finally {
      subscribers.delete(push);
    }
  });
});

const port = 7777;
serve({ fetch: app.fetch, port });
console.log(`[pixel-agents] server on http://localhost:${port}`);
