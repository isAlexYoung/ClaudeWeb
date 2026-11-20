import assert from 'node:assert/strict';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import spawn from 'cross-spawn';
import express from 'express';

import { createTaskmasterRouter } from '../taskmaster.routes.js';

const cliPath = path.resolve('tools/taskmaster/node_modules/task-master-ai/dist/task-master.js');

test('installed TaskMaster initializes via HTTP, loads tasks and persists a status change', {
  skip: !fs.existsSync(cliPath), timeout: 120000,
}, async () => {
  const projectPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'cloudcli-task-flow-'));
  const cliCalls: string[][] = [];
  const router = createTaskmasterRouter({
    fileSystem: fs, fileSystemPromises: fsPromises,
    spawnProcess: ((command: string, args: string[], options: Parameters<typeof spawn>[2]) => {
      // The bundled CLI runs with the server's own Node: never npx, an install, or a PATH lookup.
      assert.equal(command, process.execPath, 'the runtime must never use npx or install packages');
      assert.equal(args[0], cliPath);
      cliCalls.push(args.slice(1));
      return spawn(process.execPath, args, { ...options, env: { ...process.env, FORCE_COLOR: '0' } });
    }) as typeof spawn,
    resolveProjectPathById: id => id === 'project-1' ? projectPath : null,
    taskmasterService: { detectMcpServer: async () => ({ hasMCPServer: false, reason: 'CLI-only project' }) } as never,
  });
  const server = express().use(express.json()).use('/api/taskmaster', router).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/taskmaster';
  try {
    const init = await fetch(base + '/init/project-1', { method: 'POST' });
    const initialized = await init.json() as { warning?: string; output?: string };
    assert.equal(init.status, 200, JSON.stringify(initialized));
    assert.equal(initialized.warning, undefined, initialized.warning);
    const config = JSON.parse(await fsPromises.readFile(path.join(projectPath, '.taskmaster/config.json'), 'utf8'));
    for (const role of ['main', 'research', 'fallback']) assert.equal(config.models[role].provider, 'claude-code');
    const tasksPath = path.join(projectPath, '.taskmaster/tasks/tasks.json');
    const data = JSON.parse(await fsPromises.readFile(tasksPath, 'utf8'));
    assert.deepEqual(data.master.tasks, []);
    // Seed a task directly to avoid spending model quota in a runtime plumbing test.
    data.master.tasks = [{ id: 1, title: 'Runtime verification', status: 'pending', dependencies: [] }];
    await fsPromises.writeFile(tasksPath, JSON.stringify(data));
    const list = await (await fetch(base + '/tasks/project-1')).json() as { tasks: Array<{ title: string }> };
    assert.equal(list.tasks[0]?.title, 'Runtime verification');
    const update = await fetch(base + '/update-task/project-1/1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
    });
    assert.equal(update.status, 200, await update.text());
    const updated = await (await fetch(base + '/tasks/project-1')).json() as { tasks: Array<{ status: string }> };
    assert.equal(updated.tasks[0]?.status, 'done');
    assert.ok(cliCalls.some(args => args[0] === 'set-status'));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(path.dirname(projectPath), path.resolve(os.tmpdir()));
    assert.ok(path.basename(projectPath).startsWith('cloudcli-task-flow-'));
    await fsPromises.rm(projectPath, { recursive: true, force: true });
  }
});
