import fs from 'node:fs';
import path from 'node:path';

import { spawn } from 'cross-spawn';

const BUILD_TIMEOUT_MS = 60_000;

/** Used by the plugin registry and its tests to build newly installed or updated plugins. */
export function runBuildIfNeeded(dir: string, packageJsonPath: string, onSuccess: () => void, onError: (error: Error) => void): void {
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    if (!pkg.scripts?.build) {
      return onSuccess();
    }
  } catch {
    return onSuccess(); // Unreadable package.json — skip build
  }

  // The shared WebDesktop home is noexec. Node may read the compiler's JS there,
  // whereas a shell cannot execute node_modules/.bin/tsc on that mount.
  // Keep npm for other scripts and for packages that declare lifecycle hooks.
  const nodeTsc = pkg.scripts.build.trim() === 'tsc' && !pkg.scripts.prebuild && !pkg.scripts.postbuild;
  const buildProcess = spawn(nodeTsc ? process.execPath : 'npm',
    nodeTsc ? [path.join(dir, 'node_modules/typescript/bin/tsc')] : ['run', 'build'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  buildProcess.stdout?.resume();

  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    buildProcess.removeAllListeners();
    buildProcess.kill();
    onError(new Error('npm run build timed out'));
  }, BUILD_TIMEOUT_MS);

  buildProcess.stderr?.on('data', (data) => { stderr += data.toString(); });

  buildProcess.on('close', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (code !== 0) {
      return onError(new Error(`npm run build failed (exit code ${code}): ${stderr.trim()}`));
    }
    onSuccess();
  });

  buildProcess.on('error', (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    onError(new Error(`Failed to spawn build: ${err.message}`));
  });
}

