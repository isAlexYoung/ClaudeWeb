import type { spawn } from 'cross-spawn';

import { resolveTaskmasterCommand } from './taskmaster-cli.service.js';
import type { TaskmasterCommand } from './taskmaster-cli.service.js';

type TaskmasterInstallationStatus = { isInstalled: boolean; installPath: string | null; version: string | null; reason: string | null };

// StrictMode and concurrent clients can ask at once; share the in-flight version process.
const pendingChecks = new WeakMap<typeof spawn, Promise<TaskmasterInstallationStatus>>();

/** Used by TaskMaster routes to probe the installed CLI on Windows and Linux without npx downloads. */
export function checkTaskmasterInstallation(spawnProcess: typeof spawn, cli: TaskmasterCommand = resolveTaskmasterCommand()) {
  const existing = pendingChecks.get(spawnProcess);
  if (existing) return existing;
  const installPath = cli.prefixArgs[0] ?? cli.command;
  const pending = new Promise<TaskmasterInstallationStatus>((resolve) => {
    const child = spawnProcess(cli.command, [...cli.prefixArgs, '--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const complete = (isInstalled: boolean, reason: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ isInstalled, installPath: isInstalled ? installPath : null,
        version: isInstalled ? output.trim() : null, reason });
    };
    const timer = setTimeout(() => {
      complete(false, 'TaskMaster CLI version check timed out');
      child.kill();
    }, 60000);
    child.stdout?.on('data', data => { output += data.toString(); });
    child.once('error', error => complete(false, error.message));
    child.once('close', code => complete(code === 0 && Boolean(output.trim()), code === 0 && output.trim() ? null : 'TaskMaster CLI is unavailable'));
  }).finally(() => pendingChecks.delete(spawnProcess));
  pendingChecks.set(spawnProcess, pending);
  return pending;
}
