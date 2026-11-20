import type { spawn } from 'cross-spawn';

import { resolveTaskmasterCommand } from './taskmaster-cli.service.js';
import type { TaskmasterCommand } from './taskmaster-cli.service.js';

/** Used by Taskmaster routes to run the installed CLI, never the package's MCP-server bin. */
export function createTaskmasterProcessRunner(spawnProcess: typeof spawn, cli: TaskmasterCommand = resolveTaskmasterCommand()) {
  return (command: string, args: string[], options: Parameters<typeof spawn>[2],
    onComplete: (result: { code: number | null; error: Error | null; stdout: string; stderr: string }) => void) => {
    // task-master-ai is a package with multiple binaries. Its namesake binary
    // starts MCP; task-master is the CLI used for init/add-task/set-status.
    const useInstalledCli = command === 'npx' && ['task-master-ai', 'task-master'].includes(args[0]);
    const child = useInstalledCli
      ? spawnProcess(cli.command, [...cli.prefixArgs, ...args.slice(1)], options)
      : spawnProcess(command, args, options);
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout?.on('data', data => { stdout += data.toString(); });
    child.stderr?.on('data', data => { stderr += data.toString(); });
    const settle = (code: number | null, error: Error | null = null) => {
      if (settled) return;
      settled = true;
      onComplete({ code, error, stdout, stderr });
    };
    child.once('error', error => settle(null, error));
    child.once('close', code => settle(code));
    return child;
  };
}
