import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { pluginsRoutes } from '../plugins.module.js';
import { stopPluginServer } from '../plugin-process.service.js';

test('real RPC cold-starts and restarts a bundled plugin from its installation directory', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-rpc-'));
  const previous = process.env.CLOUDCLI_BUNDLED_PLUGINS_DIR;
  process.env.CLOUDCLI_BUNDLED_PLUGINS_DIR = root;
  const name = `bundled-rpc-${process.pid}`;
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ name, displayName: 'RPC fixture', entry: 'index.js', server: 'server.cjs' }));
  fs.writeFileSync(path.join(directory, 'server.cjs'), `
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ directory: process.cwd(), request: req.url }));
    });
    server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, port: server.address().port })));
  `);
  const app = express();
  app.use('/plugins', pluginsRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => {
    await stopPluginServer(name);
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.CLOUDCLI_BUNDLED_PLUGINS_DIR;
    else process.env.CLOUDCLI_BUNDLED_PLUGINS_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`http://127.0.0.1:${address.port}/plugins/${name}/rpc/dashboard?range=7`, { signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { directory, request: '/dashboard?range=7' });
    await stopPluginServer(name);
  }
});
