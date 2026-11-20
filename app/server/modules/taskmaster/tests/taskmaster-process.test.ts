import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { spawn } from 'cross-spawn';

import { createTaskmasterProcessRunner } from '../taskmaster-process.service.js';

const ON_PATH = { command: 'task-master', prefixArgs: [], bundled: false };

test('task operations invoke the installed CLI, collect output, and settle once on spawn failure', () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  const calls: unknown[][] = [];
  const results: unknown[] = [];
  const runner = createTaskmasterProcessRunner(((...args: unknown[]) => { calls.push(args); return child; }) as unknown as typeof spawn, ON_PATH);
  runner('npx', ['task-master-ai', 'list', '--json'], { cwd: '/workspace' }, result => results.push(result));
  assert.deepEqual(calls, [['task-master', ['list', '--json'], { cwd: '/workspace' }]]);
  child.stdout.emit('data', Buffer.from('tasks'));
  child.stderr.emit('data', Buffer.from('diagnostic'));
  const error = new Error('spawn failed');
  child.emit('error', error);
  child.emit('close', -1);
  assert.deepEqual(results, [{ code: null, error, stdout: 'tasks', stderr: 'diagnostic' }]);
  runner('npx', ['task-master', 'init'], {}, () => {});
  assert.deepEqual(calls[1], ['task-master', ['init'], {}]);
});

test('the bundled CLI runs with Node by its path, so PATH does not matter', () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  const calls: unknown[][] = [];
  const bundled = { command: '/opt/node/bin/node', prefixArgs: ['/opt/app/tools/taskmaster/cli.js'], bundled: true };
  const runner = createTaskmasterProcessRunner(((...args: unknown[]) => { calls.push(args); return child; }) as unknown as typeof spawn, bundled);
  runner('npx', ['task-master', 'set-status', '--id=1'], { cwd: '/w' }, () => {});
  assert.deepEqual(calls[0], ['/opt/node/bin/node', ['/opt/app/tools/taskmaster/cli.js', 'set-status', '--id=1'], { cwd: '/w' }]);
});
