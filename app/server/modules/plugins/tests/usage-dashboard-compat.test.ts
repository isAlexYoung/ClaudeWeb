import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import express from 'express';

import { createPluginsService } from '../plugins.service.js';
import { createPluginsRouter } from '../plugins.routes.js';
import { getPluginPort, startPluginServer, stopPluginServer } from '../plugin-process.service.js';

test('dashboard RPC reads real history even when an older user plugin returns 404', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-dashboard-compat-'));
  const config = path.join(root, 'config');
  const project = path.join(config, 'projects', '-home-claudeweb-Code');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'session.jsonl'), JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', message: {
    id: 'fixture-message', model: 'claude-opus-test', usage: { input_tokens: 10, output_tokens: 5 },
  } }));
  const directory = path.join(root, 'bundled', 'claude-usage');
  fs.mkdirSync(path.join(directory, 'dist'), { recursive: true });
  const actualServer = new URL('../../../../bundled-plugins/claude-usage/src/server.ts', import.meta.url);
  const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href;
  // The worker has a minimal environment. Its test-only wrapper assigns a fixture
  // Claude directory before loading the real bundled source through the test loader.
  // This also works in a clean checkout before the runtime plugin has been compiled.
  fs.writeFileSync(path.join(directory, 'dist', 'server.js'),
    `process.env.CLAUDE_CONFIG_DIR=${JSON.stringify(config)}; import(${JSON.stringify(loader)}).then(({tsImport})=>tsImport(${JSON.stringify(actualServer.href)},{parentURL:${JSON.stringify(import.meta.url)},tsconfig:false}));`);
  let legacyCalls = 0;
  const legacy = http.createServer((_req, res) => {
    legacyCalls++;
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"Not found"}');
  });
  await new Promise<void>(resolve => legacy.listen(0, '127.0.0.1', resolve));
  const address = legacy.address();
  assert.ok(address && typeof address !== 'string');
  const service = createPluginsService({
    scanPlugins: () => [], readConfig: () => ({}), saveConfig: () => {},
    getPluginDirectory: () => '/legacy/user-plugin', getBundledUsageDirectory: () => directory,
    resolveAsset: () => null, assetIsFile: () => false, contentType: () => 'application/json',
    install: async () => ({}), update: async () => ({}), uninstall: async () => {},
    startServer: startPluginServer, stopServer: async name => { await stopPluginServer(name); },
    getServerPort: name => name === 'claude-usage' ? address.port : getPluginPort(name) ?? undefined,
    isServerRunning: () => true, logError: () => {},
  });
  const app = express();
  app.use('/api/plugins', createPluginsRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => {
    await stopPluginServer('@claudeweb/local-history');
    await Promise.all([server, legacy].map(instance => new Promise<void>(resolve => instance.close(() => resolve()))));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const mounted = server.address();
  assert.ok(mounted && typeof mounted !== 'string');
  const base = `http://127.0.0.1:${mounted.port}/api/plugins/claude-usage/rpc`;
  const check = async () => {
    const response = await fetch(`${base}/dashboard?range=all&timeZone=Asia%2FKuala_Lumpur&excludeProject=%2Fhome%2Fclaudeweb`);
    assert.equal(response.status, 200);
    const body = await response.json() as { summary: { messages: number; total: number }; byModel: unknown[] };
    assert.equal(body.summary.messages, 1);
    assert.equal(body.summary.total, 15);
    assert.equal(body.byModel.length, 1);
  };
  await Promise.all([check(), check()]);
  assert.equal(legacyCalls, 0, 'dashboard never goes to the incompatible user installation');
  assert.equal((await fetch(`${base}/live`)).status, 404, 'normal plugin endpoints still use the user plugin');
  assert.equal(legacyCalls, 1);
  await stopPluginServer('@claudeweb/local-history');
  await check();
});
