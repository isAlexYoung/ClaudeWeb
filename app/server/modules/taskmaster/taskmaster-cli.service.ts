import fs from 'node:fs';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

/** Where the ClaudeWeb build installs TaskMaster (build-runtime.sh), relative to the app. */
const BUNDLED_BIN_DIRECTORY = path.join('tools', 'taskmaster', 'node_modules', '.bin');
const BUNDLED_CLI = path.join('tools', 'taskmaster', 'node_modules', 'task-master-ai', 'dist', 'task-master.js');

export type TaskmasterCommand = { command: string; prefixArgs: string[]; bundled: boolean };

const defaultAppRoot = () => findApplicationRoot(getModuleDirectory(import.meta.url));

/**
 * How to start the TaskMaster CLI: the copy shipped inside ClaudeWeb, run with
 * the server's own Node, so it is found whatever PATH the service was started
 * with; otherwise a `task-master` on PATH (a development checkout without the
 * bundled copy).
 */
export function resolveTaskmasterCommand(appRoot: string = defaultAppRoot()): TaskmasterCommand {
  const cli = path.join(appRoot, BUNDLED_CLI);
  return fs.existsSync(cli)
    ? { command: process.execPath, prefixArgs: [cli], bundled: true }
    : { command: 'task-master', prefixArgs: [], bundled: false };
}

/**
 * Puts the bundled TaskMaster's bin directory on this process's PATH, so the
 * Claude sessions ClaudeWeb starts can run `task-master` too. The service unit
 * normally does this; a VPS whose unit lost the entry showed TaskMaster as not
 * installed although it was there. Returns whether PATH changed.
 */
export function ensureTaskmasterOnPath(appRoot: string = defaultAppRoot(), env: NodeJS.ProcessEnv = process.env): boolean {
  const binDirectory = path.join(appRoot, BUNDLED_BIN_DIRECTORY);
  if (!fs.existsSync(binDirectory)) return false;
  const entries = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (entries.includes(binDirectory)) return false;
  // After the first entry (the Node toolchain the unit puts first), before the system directories.
  entries.splice(Math.min(1, entries.length), 0, binDirectory);
  env.PATH = entries.join(path.delimiter);
  return true;
}
