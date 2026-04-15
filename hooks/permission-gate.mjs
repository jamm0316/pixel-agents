#!/usr/bin/env node
// PreToolUse hook that routes permission decisions through the pixel-agents web UI.
// If the server is unreachable or times out, falls back to Claude Code's default "ask".

import { randomUUID } from 'node:crypto';

const SERVER = process.env.PIXEL_AGENTS_SERVER ?? 'http://localhost:7777';
const TIMEOUT_MS = 10 * 60_000;
const SAFE_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'TodoWrite',
  'WebSearch',
  'WebFetch',
  'Task', // Task routing is its own permission flow — don't gate
]);

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function output(decision) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
      },
    })
  );
  process.exit(0);
}

try {
  const raw = await readStdin();
  const parsed = JSON.parse(raw);
  const tool = parsed.tool_name;
  const sessionId = parsed.session_id;

  if (!tool || !sessionId) output('ask');
  if (SAFE_TOOLS.has(tool)) output('allow');

  const requestId = randomUUID();
  const body = JSON.stringify({
    requestId,
    sessionId,
    tool,
    input: parsed.tool_input ?? {},
  });

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  const res = await fetch(`${SERVER}/api/permission-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: ctrl.signal,
  }).catch(() => null);
  clearTimeout(to);

  if (!res || !res.ok) output('ask');

  const json = await res.json().catch(() => null);
  const decision = json?.decision;
  if (decision === 'allow' || decision === 'deny') output(decision);
  output('ask');
} catch {
  output('ask');
}
