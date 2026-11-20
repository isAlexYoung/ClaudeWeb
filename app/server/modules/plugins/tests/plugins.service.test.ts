import assert from 'node:assert/strict';
import test from 'node:test';

import { createPluginsService } from '../plugins.service.js';

type Dependencies = Parameters<typeof createPluginsService>[0];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    scanPlugins: () => [], readConfig: () => ({}), saveConfig: () => undefined,
    getPluginDirectory: () => null,
    resolveAsset: () => null, assetIsFile: () => false, contentType: () => 'text/plain',
    install: async () => ({ name: 'plugin', dirName: 'plugin' }),
    update: async () => ({ name: 'plugin', dirName: 'plugin' }),
    uninstall: async () => undefined, startServer: async () => 4000,
    stopServer: async () => undefined, getServerPort: () => undefined,
    isServerRunning: () => false,
    logError: () => undefined, ...overrides,
  };
}

test('update restarts a running plugin server when the update fails', async () => {
  const operations: string[] = [];
  let running = true;
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', dirName: 'demo', server: 'server.js' }],
    getPluginDirectory: () => '/plugins/demo',
    isServerRunning: () => running,
    stopServer: async () => { operations.push('stop'); running = false; },
    update: async () => { operations.push('pull'); throw new Error('git pull failed'); },
    startServer: async () => { operations.push('start'); running = true; return 4000; },
  }));
  await assert.rejects(service.update('demo'), /git pull failed/);
  assert.deepEqual(operations, ['stop', 'pull', 'start']);
});

test('a failed update does not start a plugin server that was not running', async () => {
  const operations: string[] = [];
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', dirName: 'demo', server: 'server.js' }],
    getPluginDirectory: () => '/plugins/demo',
    update: async () => { operations.push('pull'); throw new Error('git pull failed'); },
    startServer: async () => { operations.push('start'); return 4000; },
  }));
  await assert.rejects(service.update('demo'), /git pull failed/);
  assert.deepEqual(operations, ['pull']);
});

test('setEnabled persists configuration and starts an enabled plugin server', async () => {
  const operations: string[] = [];
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', dirName: 'demo', server: { entry: 'server.js' } }],
    getPluginDirectory: () => '/plugins/demo',
    saveConfig: () => operations.push('save'),
    startServer: async () => { operations.push('start'); return 4000; },
  }));
  await service.setEnabled('demo', true);
  assert.deepEqual(operations, ['save', 'start']);
});

test('RPC restarts the discovered bundled installation, not a constructed user-plugin path', async () => {
  const started: string[] = [];
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'claude-usage', enabled: true, server: 'dist/server.js' }],
    getPluginDirectory: () => '/opt/claudeweb/bundled-plugins/claude-usage',
    readConfig: () => ({ 'claude-usage': { secrets: { demo: 'fixture' } } }),
    startServer: async (_name, directory) => { started.push(directory); return 4001; },
  }));
  assert.deepEqual(await service.prepareRpc('claude-usage'), { port: 4001, secrets: { demo: 'fixture' } });
  assert.deepEqual(started, ['/opt/claudeweb/bundled-plugins/claude-usage']);
});

test('RPC does not start disabled or missing plugin installations', async () => {
  let starts = 0;
  const service = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', enabled: false, server: 'server.js' }],
    startServer: async () => { starts++; return 4000; },
  }));
  await assert.rejects(service.prepareRpc('demo'), /disabled/);
  const missing = createPluginsService(dependencies({
    scanPlugins: () => [{ name: 'demo', enabled: true, server: 'server.js' }],
  }));
  await assert.rejects(missing.prepareRpc('demo'), /directory is unavailable/);
  assert.equal(starts, 0);
});

test('local dashboard uses the bundled implementation when a running older user plugin shadows it', async () => {
  const started: string[][] = [];
  const service = createPluginsService(dependencies({
    getBundledUsageDirectory: () => '/opt/app/bundled-plugins/claude-usage',
    getPluginDirectory: () => '/user/plugins/claude-usage',
    getServerPort: name => name === 'claude-usage' ? 3000 : undefined,
    startServer: async (name, directory, entry) => { started.push([name, directory, String(entry)]); return 4001; },
  }));
  assert.deepEqual(await service.prepareUsageDashboard(), { port: 4001, secrets: {} });
  assert.deepEqual(started, [['@claudeweb/local-history', '/opt/app/bundled-plugins/claude-usage', 'dist/server.js']]);
  assert.equal((await service.prepareRpc('claude-usage')).port, 3000, 'normal plugin requests preserve the user installation');
});

test('local dashboard reuses the running bundled server and OSS retains its existing plugin transport', async () => {
  const bundled = createPluginsService(dependencies({
    getBundledUsageDirectory: () => '/bundled/claude-usage',
    getPluginDirectory: () => '/bundled/claude-usage',
    getServerPort: () => 4100,
    startServer: async () => { throw new Error('must reuse the current worker'); },
  }));
  assert.equal((await bundled.prepareUsageDashboard()).port, 4100);
  const standalone = createPluginsService(dependencies({ getServerPort: () => 4200 }));
  assert.equal((await standalone.prepareUsageDashboard()).port, 4200);
});
