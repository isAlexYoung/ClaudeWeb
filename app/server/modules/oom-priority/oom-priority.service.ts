import fs from 'node:fs';
import path from 'node:path';

/**
 * When the server runs out of memory, Linux should end what ClaudeWeb started
 * (Claude, terminals, the browser) before ClaudeWeb itself, so the page stays
 * up. The unit gives the service a slightly lower score (OOMScoreAdjust=-100);
 * this raises every process below it to CHILD_SCORE. Raising a score needs no
 * privilege, and a child's own children inherit it when they start. The tree
 * is walked again every few seconds for processes started in between.
 */
export const CHILD_SCORE = 500;

type ProcTree = { procRoot?: string; rootPid?: number };

/** Every process below rootPid, from /proc's parent links. */
export function descendants({ procRoot = '/proc', rootPid = process.pid }: ProcTree = {}): number[] {
  const children = new Map<number, number[]>();
  let names: string[];
  try { names = fs.readdirSync(procRoot); } catch { return []; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let stat: string;
    try { stat = fs.readFileSync(path.join(procRoot, name, 'stat'), 'utf8'); } catch { continue; }
    // The command name is in parentheses and may contain spaces; the parent pid follows the state.
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const parent = Number(after[1]);
    if (!Number.isInteger(parent)) continue;
    const list = children.get(parent) ?? [];
    list.push(Number(name));
    children.set(parent, list);
  }
  const found: number[] = [];
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length) {
    const pid = queue.shift() as number;
    found.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

/** Raises each process below rootPid that scores lower; returns how many changed. */
export function raiseChildren({ procRoot = '/proc', rootPid = process.pid, score = CHILD_SCORE }: ProcTree & { score?: number } = {}): number {
  let changed = 0;
  for (const pid of descendants({ procRoot, rootPid })) {
    const file = path.join(procRoot, String(pid), 'oom_score_adj');
    try {
      if (Number(fs.readFileSync(file, 'utf8').trim()) >= score) continue;
      fs.writeFileSync(file, String(score));
      changed += 1;
    } catch {
      // Gone already, or not ours (a setuid helper such as sudo).
    }
  }
  return changed;
}

/** Started by the server on Linux; the timer never keeps the process alive. */
export function startChildOomPriority(intervalMs = 5000): () => void {
  if (process.platform !== 'linux') return () => {};
  raiseChildren();
  const timer = setInterval(() => raiseChildren(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
