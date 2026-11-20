import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { createTaskmasterProcessRunner } from './taskmaster-process.service.js';

type TaskmasterRunner = ReturnType<typeof createTaskmasterProcessRunner>;
type TaskmasterRunResult = Parameters<Parameters<TaskmasterRunner>[3]>[0];

// TaskMaster's `claude-code` provider runs through the user's Claude Code login,
// so a ClaudeWeb project needs no separate API key for task generation.
const CLAUDE_CODE_MODEL = 'sonnet';
const MODEL_ROLE_FLAGS = ['--set-main', '--set-research', '--set-fallback'];

const runToCompletion = (run: TaskmasterRunner, args: string[], cwd: string) => new Promise<TaskmasterRunResult>((resolve) => {
  run('npx', ['task-master', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }, resolve);
});

/**
 * Used by the TaskMaster routes right after `task-master init`: points every
 * TaskMaster model role at the Claude Code provider, makes that provider run the
 * CLI ClaudeWeb itself uses (`CLAUDE_CLI_PATH`) rather than the copy bundled in
 * TaskMaster's dependencies, and creates the empty task list `init` leaves out,
 * so a manual task can be added before any PRD is parsed.
 */
export async function applyClaudeCodeTaskmasterDefaults(
  projectPath: string,
  run: TaskmasterRunner,
  claudeCliPath: string | undefined = process.env.CLAUDE_CLI_PATH,
): Promise<void> {
  for (const roleFlag of MODEL_ROLE_FLAGS) {
    const result = await runToCompletion(run, ['models', roleFlag, CLAUDE_CODE_MODEL, '--claude-code'], projectPath);
    if (result.code !== 0) {
      throw new Error(result.error?.message || result.stderr || result.stdout || `task-master models ${roleFlag} failed`);
    }
  }

  const taskmasterDirectory = path.join(projectPath, '.taskmaster');
  if (claudeCliPath) {
    const configPath = path.join(taskmasterDirectory, 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
    const claudeCode = typeof config.claudeCode === 'object' && config.claudeCode !== null ? config.claudeCode : {};
    config.claudeCode = { ...claudeCode, pathToClaudeCodeExecutable: claudeCliPath };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  const tasksPath = path.join(taskmasterDirectory, 'tasks', 'tasks.json');
  try {
    await fs.access(tasksPath);
  } catch {
    const now = new Date().toISOString();
    await fs.mkdir(path.dirname(tasksPath), { recursive: true });
    await fs.writeFile(tasksPath, `${JSON.stringify({
      master: { tasks: [], metadata: { created: now, updated: now, description: 'Tasks for master context' } },
    }, null, 2)}\n`);
  }
}
