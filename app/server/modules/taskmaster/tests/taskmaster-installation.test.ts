import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { spawn } from 'cross-spawn';

import { ensureTaskmasterOnPath, resolveTaskmasterCommand } from '../taskmaster-cli.service.js';
import { checkTaskmasterInstallation } from '../taskmaster-installation.service.js';

const ON_PATH = { command: 'task-master', prefixArgs: [], bundled: false };

test('installation probe uses the installed CLI directly without requiring which or npx', async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
  const calls: unknown[][] = [];
  const pending = checkTaskmasterInstallation(((...args: unknown[]) => { calls.push(args); return child; }) as unknown as typeof spawn, ON_PATH);
  child.stdout.emit('data', '0.43.1');
  child.emit('close', 0);
  assert.deepEqual(calls[0]?.slice(0, 2), ['task-master', ['--version']]);
  assert.equal((await pending).isInstalled, true);
});

test('a missing CLI settles once on error followed by close', async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
  const pending = checkTaskmasterInstallation((() => child) as unknown as typeof spawn, ON_PATH);
  child.emit('error', new Error('ENOENT'));
  child.emit('close', 1);
  assert.equal((await pending).reason, 'ENOENT');
});

test('the copy bundled with ClaudeWeb is found by path, and its bin directory is put on PATH', async () => {
  const appRoot = await mkdtemp(path.join(tmpdir(), 'claudeweb-app-'));
  try {
    // Without the bundled copy, the CLI is looked up on PATH.
    assert.deepEqual(resolveTaskmasterCommand(appRoot), ON_PATH);

    const cli = path.join(appRoot, 'tools', 'taskmaster', 'node_modules', 'task-master-ai', 'dist', 'task-master.js');
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, '');
    await mkdir(path.join(appRoot, 'tools', 'taskmaster', 'node_modules', '.bin'), { recursive: true });
    assert.deepEqual(resolveTaskmasterCommand(appRoot), { command: process.execPath, prefixArgs: [cli], bundled: true });

    // A service started without the entry (as seen on a VPS) gets it after the Node toolchain.
    const env: NodeJS.ProcessEnv = { PATH: ['/opt/node/bin', '/usr/bin', '/bin'].join(path.delimiter) };
    assert.equal(ensureTaskmasterOnPath(appRoot, env), true);
    const binDirectory = path.join(appRoot, 'tools', 'taskmaster', 'node_modules', '.bin');
    assert.deepEqual(env.PATH?.split(path.delimiter), ['/opt/node/bin', binDirectory, '/usr/bin', '/bin']);
    assert.equal(ensureTaskmasterOnPath(appRoot, env), false, 'already there: unchanged');
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});
