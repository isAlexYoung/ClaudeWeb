import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readNameBlock, readOutputStyleFile, writeNameBlock, yourClaudeService } from '@/modules/providers/services/your-claude.service.js';

/** Settings > Your Claude edits only its own block of CLAUDE.md and its own settings.json keys. */

async function withConfigDir(t: test.TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'your-claude-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('the name block is added on top, replaced in place and removed, keeping the user\'s own lines', () => {
  const own = '# My rules\n\nAlways answer in Chinese.\n';
  const named = writeNameBlock(own, 'Alex');
  assert.equal(readNameBlock(named), 'Alex');
  assert.ok(named.endsWith(own));
  const renamed = writeNameBlock(named, 'Alex Chen');
  assert.equal(readNameBlock(renamed), 'Alex Chen');
  assert.equal(renamed.split('ClaudeWeb: name').length, 3);
  assert.equal(writeNameBlock(renamed, ''), own);
  assert.equal(writeNameBlock('', ''), '');
});

test('settings keys are set, cleared back to the CLI default, and other keys survive', async (t) => {
  const directory = await withConfigDir(t);
  const settingsPath = path.join(directory, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls)'] } }));

  const first = await yourClaudeService.update({ autoMemoryEnabled: false, autoMemoryDirectory: ' ~/notes/memory ', autoDreamEnabled: true });
  assert.deepEqual(
    [first.autoMemoryEnabled, first.autoMemoryDirectory, first.autoDreamEnabled, first.settingsStatus],
    [false, '~/notes/memory', true, 'ok'],
  );
  const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.equal(written.model, 'opus');
  assert.deepEqual(written.permissions, { allow: ['Bash(ls)'] });

  const cleared = await yourClaudeService.update({ autoMemoryDirectory: '', autoDreamEnabled: null });
  assert.equal(cleared.autoMemoryDirectory, null);
  assert.equal(cleared.autoDreamEnabled, null);
  const after = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.equal('autoDreamEnabled' in after, false);
  assert.equal('autoMemoryDirectory' in after, false);
  assert.equal(after.autoMemoryEnabled, false);
});

test('the name goes to the config directory\'s CLAUDE.md, created when missing', async (t) => {
  const directory = await withConfigDir(t);
  const result = await yourClaudeService.update({ name: '  Alex   Chen ' });
  assert.equal(result.name, 'Alex Chen');
  assert.equal(result.claudeMdPath, path.join(directory, 'CLAUDE.md'));
  assert.match(await fs.readFile(result.claudeMdPath, 'utf8'), /Address the user as "Alex Chen"\./);
  assert.equal(result.settingsStatus, 'missing');
});

test('an invalid settings.json is reported and never overwritten; bad values are refused', async (t) => {
  const directory = await withConfigDir(t);
  const settingsPath = path.join(directory, 'settings.json');
  await fs.writeFile(settingsPath, '{ broken');
  assert.equal((await yourClaudeService.read()).settingsStatus, 'invalid');
  await assert.rejects(yourClaudeService.update({ autoMemoryEnabled: false }), /not valid JSON/);
  assert.equal(await fs.readFile(settingsPath, 'utf8'), '{ broken');
  // The name lives in CLAUDE.md, so it can still be saved.
  assert.equal((await yourClaudeService.update({ name: 'Alex' })).name, 'Alex');

  await assert.rejects(yourClaudeService.update({ autoMemoryDirectory: 'relative/path' }), /absolute path/);
  await assert.rejects(yourClaudeService.update({ autoDreamEnabled: 'yes' }), /true, false or null/);
  await assert.rejects(yourClaudeService.update({ name: 'x'.repeat(61) }), /longer than/);
  await assert.rejects(yourClaudeService.update({ name: 'a "quoted" name' }), /quotes/);
});

test('output styles list the built-ins plus style files, and the choice is the outputStyle key', async (t) => {
  const directory = await withConfigDir(t);
  await fs.mkdir(path.join(directory, 'output-styles'));
  await fs.writeFile(path.join(directory, 'output-styles', 'terse.md'), '---\nname: Terse\ndescription: "Short answers"\n---\nBe brief.');
  await fs.writeFile(path.join(directory, 'output-styles', 'plain.md'), 'No front matter.');
  await fs.writeFile(path.join(directory, 'output-styles', 'Learning.md'), '---\nname: Learning\n---\nShadowed.');

  const before = await yourClaudeService.read();
  assert.equal(before.outputStyle, null);
  assert.deepEqual(before.outputStyles.map((style) => [style.name, style.builtIn]), [
    ['Explanatory', true], ['Learning', true], ['Proactive', true], ['plain', false], ['Terse', false],
  ]);
  assert.equal(before.outputStyles.find((style) => style.name === 'Terse')?.description, 'Short answers');

  assert.equal((await yourClaudeService.update({ outputStyle: 'Terse' })).outputStyle, 'Terse');
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).outputStyle, 'Terse');
  assert.equal((await yourClaudeService.update({ outputStyle: 'default' })).outputStyle, null);
  assert.equal('outputStyle' in JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')), false);
  await assert.rejects(yourClaudeService.update({ outputStyle: 'bad\nname' }), /not a valid style/);
});

test('a style file without front matter is named after the file', () => {
  assert.deepEqual(readOutputStyleFile('My Style.md', 'text'), { name: 'My Style', description: '', builtIn: false });
});
