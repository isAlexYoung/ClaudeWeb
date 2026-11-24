import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { providerSkillsService } from '@/modules/providers/services/skills.service.js';
import { removeProviderSkillEntry, setProviderSkillEnabled } from '@/modules/providers/services/skill-state.service.js';

test('connector toggles persist across scopes, preserve credentials and exclude disabled definitions from native runtime maps', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-extension-state-'));
  const workspacePath = path.join(root, 'project');
  await fs.mkdir(workspacePath);
  const home = os.homedir;
  os.homedir = () => root;
  try {
    for (const scope of ['user', 'project', 'local'] as const) {
      await providerMcpService.upsertProviderMcpServer('claude', { name: 'example', scope, workspacePath, transport: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer preserved-secret' } });
      await providerMcpService.setProviderMcpEnabled('claude', { name: 'example', scope, workspacePath, enabled: false });
      const items = await providerMcpService.listProviderMcpServersForScope('claude', scope, { workspacePath });
      assert.equal(items[0].enabled, false);
      assert.equal(items[0].headers?.Authorization, 'Bearer preserved-secret');
      const config = JSON.parse(await fs.readFile(path.join(scope === 'project' ? workspacePath : root, scope === 'project' ? '.mcp.json' : '.claude.json'), 'utf8'));
      const scoped = scope === 'local' ? config.projects[workspacePath] : config;
      assert.equal(scoped.mcpServers.example, undefined);
      assert.equal(scoped.claudewebDisabledMcpServers.example.headers.Authorization, 'Bearer preserved-secret');
      // Editing a disabled connector must not silently turn it back on.
      await providerMcpService.upsertProviderMcpServer('claude', { name: 'example', scope, workspacePath, transport: 'http', url: 'https://example.test/updated', headers: { Authorization: 'Bearer edited-secret' } });
      assert.equal((await providerMcpService.listProviderMcpServersForScope('claude', scope, { workspacePath }))[0].enabled, false);
      await providerMcpService.setProviderMcpEnabled('claude', { name: 'example', scope, workspacePath, enabled: true });
      const enabled = await providerMcpService.listProviderMcpServersForScope('claude', scope, { workspacePath });
      assert.notEqual(enabled[0].enabled, false);
      assert.equal(enabled[0].url, 'https://example.test/updated');
      await providerMcpService.setProviderMcpEnabled('claude', { name: 'example', scope, workspacePath, enabled: false });
      assert.equal((await providerMcpService.removeProviderMcpServer('claude', { name: 'example', scope, workspacePath })).removed, true);
      assert.deepEqual(await providerMcpService.listProviderMcpServersForScope('claude', scope, { workspacePath }), []);
    }
    await Promise.all(['one', 'two'].map(name => providerMcpService.upsertProviderMcpServer('claude', { name, scope: 'user', transport: 'http', url: 'https://example.test/' + name })));
    await Promise.all(['one', 'two'].map(name => providerMcpService.setProviderMcpEnabled('claude', { name, scope: 'user', enabled: false })));
    const concurrent = await providerMcpService.listProviderMcpServersForScope('claude', 'user');
    assert.equal(concurrent.length, 2);
    assert.ok(concurrent.every(server => server.enabled === false));
  } finally { os.homedir = home; await fs.rm(root, { recursive: true, force: true }); }
});

test('skill toggles survive discovery reload, keep supporting files, and reject entries outside the provider catalog', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-skill-state-'));
  const home = os.homedir;
  os.homedir = () => root;
  try {
    const [installed] = await providerSkillsService.addProviderSkills('claude', { entries: [{ directoryName: 'sample', content: '---\nname: Sample\ndescription: Persistent test skill\n---\nInstructions', files: [{ relativePath: 'references/notes.md', content: 'keep this', encoding: 'utf8' }] }] });
    await setProviderSkillEnabled('claude', installed.sourcePath, false);
    assert.deepEqual(await providerSkillsService.listProviderSkills('claude'), []);
    const managed = await providerSkillsService.listProviderSkills('claude', { includeDisabled: true });
    assert.equal(managed[0].enabled, false);
    assert.equal(managed[0].sourcePath, installed.sourcePath);
    assert.equal(await fs.readFile(path.join(path.dirname(installed.sourcePath), 'references/notes.md'), 'utf8'), 'keep this');
    await providerSkillsService.addProviderSkills('claude', { entries: [{ directoryName: 'sample', content: '---\nname: Sample\ndescription: Updated while disabled\n---\nNew instructions' }] });
    assert.deepEqual(await providerSkillsService.listProviderSkills('claude'), []);
    assert.equal((await providerSkillsService.listProviderSkills('claude', { includeDisabled: true }))[0].description, 'Updated while disabled');
    await assert.rejects(setProviderSkillEnabled('claude', path.join(root, 'secret.md'), true), /not found/i);
    await setProviderSkillEnabled('claude', installed.sourcePath, true);
    assert.equal((await providerSkillsService.listProviderSkills('claude'))[0].name, 'Sample');
    await setProviderSkillEnabled('claude', installed.sourcePath, false);
    await removeProviderSkillEntry('claude', installed.sourcePath);
    assert.deepEqual(await providerSkillsService.listProviderSkills('claude', { includeDisabled: true }), []);
  } finally { os.homedir = home; await fs.rm(root, { recursive: true, force: true }); }
});

test('project and plugin-owned skill entries can be parked without disabling sibling skills', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-scoped-skill-state-'));
  const home = os.homedir;
  os.homedir = () => root;
  try {
    const workspacePath = path.join(root, 'workspace');
    const projectSkill = path.join(workspacePath, '.claude', 'skills', 'project-skill', 'SKILL.md');
    await fs.mkdir(path.dirname(projectSkill), { recursive: true });
    await fs.writeFile(projectSkill, '---\nname: Project Skill\n---\nProject instructions');
    const pluginRoot = path.join(root, '.claude', 'plugins');
    const installPath = path.join(pluginRoot, 'cache', 'demo', '1.0.0');
    await fs.mkdir(path.join(installPath, 'commands'), { recursive: true });
    await fs.writeFile(path.join(installPath, 'commands', 'summarize.md'), '---\ndescription: Summarize a conversation\n---\nInstructions');
    await fs.writeFile(path.join(root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'demo@market': true } }));
    await fs.writeFile(path.join(pluginRoot, 'installed_plugins.json'), JSON.stringify({ plugins: { 'demo@market': [{ installPath }] } }));
    const before = await providerSkillsService.listProviderSkills('claude', { workspacePath });
    assert.equal(before.length, 2);
    for (const entry of before) await setProviderSkillEnabled('claude', entry.sourcePath, false, workspacePath);
    assert.deepEqual(await providerSkillsService.listProviderSkills('claude', { workspacePath }), []);
    const parked = await providerSkillsService.listProviderSkills('claude', { workspacePath, includeDisabled: true });
    assert.equal(parked.length, 2);
    assert.ok(parked.every(entry => entry.enabled === false));
    assert.equal(parked.find(entry => entry.scope === 'plugin')?.command, '/demo:summarize');
    for (const entry of parked) await setProviderSkillEnabled('claude', entry.sourcePath, true, workspacePath);
    assert.equal((await providerSkillsService.listProviderSkills('claude', { workspacePath })).length, 2);
  } finally { os.homedir = home; await fs.rm(root, { recursive: true, force: true }); }
});
