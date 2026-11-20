import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import type { AddressInfo } from 'node:net';
import { createProjectMemoryRouter } from '@/modules/project-memory/project-memory.routes.js';
import { createProjectMemoryService } from '@/modules/project-memory/project-memory.service.js';
import type { ProjectMemorySnapshot } from '@/shared/types.js';

test('authenticated HTTP CRUD passes exact text and versions, rejects stale writes and unregistered project paths', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudeweb-memory-http-'));
  const service = createProjectMemoryService(id => id === 'p1' ? root : null);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers.authorization) (req as express.Request & { user: { id: number } }).user = { id: 1 }; next(); });
  app.use('/api/project-memory', createProjectMemoryRouter(service));
  app.use((error: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode || 500).json({ error: { code: error.code } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/project-memory/`;
  const request = (suffix: string, method = 'GET', body?: unknown, auth = true) => fetch(url + suffix, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer fixture' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('p1', 'GET', undefined, false)).status, 401);
  const initial = await (await request('p1')).json() as ProjectMemorySnapshot;
  const createdResponse = await request('p1', 'POST', { text: '规则内容', version: initial.version, sessionId: 's1', source: { text: '原文', messageKey: 'm1', role: 'assistant', kind: 'text' } });
  assert.equal(createdResponse.status, 201);
  let current = await createdResponse.json() as ProjectMemorySnapshot;
  assert.equal(current.entries[0].text, '规则内容');
  assert.equal((await request('p1/' + current.entries[0].id, 'PATCH', { text: 'stale', version: initial.version })).status, 409);
  current = await (await request('p1/' + current.entries[0].id, 'PATCH', { text: '更新规则', version: current.version })).json() as ProjectMemorySnapshot;
  assert.equal(current.entries[0].text, '更新规则');
  const deleted = await (await request('p1/' + current.entries[0].id, 'DELETE', { version: current.version })).json() as ProjectMemorySnapshot;
  assert.deepEqual(deleted.entries, []);
  assert.equal((await request('unregistered')).status, 404);
  assert.equal((await request('p1', 'POST', [])).status, 400);
});
