/**
 * What the Clawd above a conversation's composer does for each thing Claude can be doing.
 * Each state has several animations; a double click steps to the next one of the same state.
 */
export type ClawdState =
  | 'idle' | 'thinking' | 'writing' | 'editing' | 'command' | 'searching' | 'agent' | 'planning' | 'tool'
  | 'waiting' | 'done' | 'error' | 'stopped' | 'sleeping' | 'compacting';

export const CLAWD_STATE_ANIMATIONS: Record<ClawdState, number[]> = {
  idle: [7, 6, 35, 20, 38, 40, 63, 73, 167],
  thinking: [190, 19, 71, 184, 189, 36],
  writing: [18, 218, 173, 186],
  editing: [173, 183, 227, 212, 210],
  command: [174, 175, 178, 229],
  searching: [177, 192, 22, 24, 305],
  agent: [194, 214, 209],
  planning: [200, 214, 201],
  tool: [191, 209, 220],
  waiting: [76, 11, 87],
  done: [56, 54, 62, 77, 219, 193],
  error: [90, 85, 107, 230],
  stopped: [102, 101, 74],
  sleeping: [147, 23, 109, 206],
  compacting: [232, 231, 143, 135],
};

/** Claude Code's tool names, by the kind of work Clawd acts out. */
export function stateForTool(name: string | undefined): ClawdState {
  if (!name) return 'tool';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return 'editing';
  if (/^(Bash|BashOutput|KillShell|KillBash|PowerShell)$/.test(name)) return 'command';
  if (/^(Read|Grep|Glob|LS|WebSearch|WebFetch|ToolSearch|NotebookRead)$/.test(name)) return 'searching';
  if (/^(Task|Agent)$/.test(name)) return 'agent';
  if (/^(TodoWrite|TodoRead|ExitPlanMode)$/.test(name)) return 'planning';
  return 'tool';
}

/** The next animation of the same state, for a double click. */
export function nextAnimation(pool: number[], current: number): number {
  if (pool.length === 0) return current;
  const index = pool.indexOf(current);
  return pool[(index + 1) % pool.length];
}

/** A random animation of a state, other than the one showing when there is a choice. */
export function randomAnimation(pool: number[], avoid?: number, roll = Math.random()): number {
  const choices = pool.length > 1 && avoid !== undefined ? pool.filter((n) => n !== avoid) : pool;
  return choices[Math.floor(roll * choices.length)] ?? pool[0];
}
