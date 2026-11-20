import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getPluginDir, scanPlugins, uninstallPlugin, updatePluginFromGit } from '../plugin-registry.service.js';

test('bundled plugins are discovered enabled and cannot be updated or uninstalled as user files', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-quota-'));
  const previous = process.env.CLAUDEWEB_BUNDLED_PLUGINS_DIR;
  process.env.CLAUDEWEB_BUNDLED_PLUGINS_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.CLAUDEWEB_BUNDLED_PLUGINS_DIR; else process.env.CLAUDEWEB_BUNDLED_PLUGINS_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const name = `bundled-fixture-${process.pid}`;
  fs.mkdirSync(path.join(root, name));
  fs.writeFileSync(path.join(root, name, 'manifest.json'), JSON.stringify({ name, displayName: 'Quota fixture', entry: 'index.js' }));
  assert.equal(scanPlugins().find(plugin => plugin.name === name)?.bundled, true);
  assert.equal(scanPlugins().find(plugin => plugin.name === name)?.enabled, true);
  assert.equal(getPluginDir(name), path.join(root, name));
  await assert.rejects(uninstallPlugin(name), /managed by ClaudeWeb/);
  await assert.rejects(updatePluginFromGit(name), /updated with ClaudeWeb/);
  assert.equal(fs.existsSync(path.join(root, name, 'manifest.json')), true);
});
