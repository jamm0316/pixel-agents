import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentDef } from './types.ts';

const MAIN_AGENT: AgentDef = {
  name: 'main',
  description: 'Main Claude Code session agent',
  model: 'opus',
};

export async function loadSquad(cwd: string): Promise<AgentDef[]> {
  const dir = join(cwd, '.claude', 'agents');
  try {
    const files = await readdir(dir);
    const defs: AgentDef[] = [MAIN_AGENT];
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const text = await readFile(join(dir, f), 'utf8').catch(() => '');
      defs.push(parseFrontmatter(text, f.replace(/\.md$/, '')));
    }
    return defs;
  } catch {
    return [MAIN_AGENT];
  }
}

function parseFrontmatter(text: string, fallbackName: string): AgentDef {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return { name: fallbackName };
  const block = m[1];
  const get = (key: string) => {
    const line = block.split('\n').find((l) => l.startsWith(`${key}:`));
    if (!line) return undefined;
    return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  };
  return {
    name: get('name') ?? fallbackName,
    description: get('description'),
    model: get('model'),
  };
}
