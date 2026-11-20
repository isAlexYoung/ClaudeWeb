import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { createProjectMemoryService } from '@/modules/project-memory/project-memory.service.js';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudeweb-memory-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const first = path.join(root, 'first'), second = path.join(root, 'second');
  await fs.mkdir(first); await fs.mkdir(second);
  const service = createProjectMemoryService(id => id === 'p1' ? first : id === 'p2' ? second : null);
  const source = { messageKey: 'assistant-1', text: 'selected thought snapshot', role: 'assistant', kind: 'thinking', timestamp: '2026-11-19T00:00:00Z', startOffset: 8 };
  const create = async (text = 'Always use Chinese for this project') => service.create('p1', { text, source, sessionId: 'session-1', version: (await service.list('p1')).version });
  return { root, first, second, service, source, create };
}

test('creates file-backed memory, keeps source JSON out of instructions, and shares it by project', async t => {
  const h = await fixture(t);
  const empty = await h.service.list('p1'); assert.equal(empty.entries.length, 0);
  await assert.rejects(fs.stat(path.join(h.first, '.claude')), /ENOENT/);
  const saved = await h.create();
  assert.equal(saved.entries[0].text, 'Always use Chinese for this project');
  assert.equal(saved.entries[0].source?.text, h.source.text); assert.equal(saved.entries[0].sourceSessionId, 'session-1');
  const contents = await fs.readFile(saved.path, 'utf8');
  assert.ok(contents.includes(saved.entries[0].text)); assert.ok(!contents.includes(h.source.text)); assert.ok(!contents.includes('messageKey'));
  assert.equal((await h.service.list('p2')).entries.length, 0);
  assert.equal((await h.service.list('p1')).entries[0].id, saved.entries[0].id);
});

test('edit and delete preserve all unmanaged instructions and other entries, with stable source and ordering', async t => {
  const h = await fixture(t);
  const file = path.join(h.first, 'CLAUDE.md'), original = '# My rules\r\n\r\nLeave this exactly as written.\r\n';
  await fs.writeFile(file, original);
  let saved = await h.create('first rule'); saved = await h.create('second rule');
  const id = saved.entries[0].id;
  saved = await h.service.update('p1', id, { text: 'revised rule', version: saved.version });
  assert.equal(saved.entries[0].source?.text, h.source.text);
  assert.deepEqual(saved.entries.map(entry => entry.text), ['revised rule', 'second rule']);
  saved = await h.service.remove('p1', id, saved.version);
  assert.deepEqual(saved.entries.map(entry => entry.text), ['second rule']);
  assert.ok((await fs.readFile(file, 'utf8')).startsWith(original));
  await assert.rejects(h.service.remove('p2', saved.entries[0].id, (await h.service.list('p2')).version), /MEMORY_NOT_FOUND/);
});

test('stale tabs cannot overwrite another device or external edit, and duplicate creation is idempotent', async t => {
  const h = await fixture(t);
  const stale = await h.service.list('p1'); let current = await h.create();
  await assert.rejects(h.service.create('p1', { text: 'lost update', source: h.source, sessionId: 's2', version: stale.version }), /MEMORY_VERSION_CONFLICT/);
  const duplicate = await h.create(); assert.equal(duplicate.entries.length, 1); assert.equal(duplicate.entries[0].id, current.entries[0].id);
  current = await h.service.list('p1');
  await fs.appendFile(current.path, '\n# External editor\n');
  await assert.rejects(h.service.update('p1', current.entries[0].id, { text: 'overwrite', version: current.version }), /MEMORY_VERSION_CONFLICT/);
  assert.ok((await fs.readFile(current.path, 'utf8')).includes('# External editor'));
});

test('external changes refresh actual entry text and removed entries never reappear from sidecar metadata', async t => {
  const h = await fixture(t); const saved = await h.create('old text');
  let content = await fs.readFile(saved.path, 'utf8');
  await fs.writeFile(saved.path, content.replace('old text', 'external text'));
  assert.equal((await h.service.list('p1')).entries[0].text, 'external text');
  content = content.replace(/<!-- claudeweb-memory:[\s\S]*?<!-- \/claudeweb-memory:[^>]+-->/, '');
  await fs.writeFile(saved.path, content);
  assert.deepEqual((await h.service.list('p1')).entries, []);
});

test('damaged managed sections and reserved markers fail without replacing the file', async t => {
  const h = await fixture(t); const saved = await h.create();
  const damaged = (await fs.readFile(saved.path, 'utf8')).replace('<!-- /claudeweb-memory:', '<!-- broken:');
  await fs.writeFile(saved.path, damaged);
  await assert.rejects(h.service.list('p1'), /MEMORY_FORMAT_CONFLICT/);
  await assert.rejects(h.service.update('p1', saved.entries[0].id, { text: 'new rule', version: saved.version }), /MEMORY_VERSION_CONFLICT/);
  assert.equal(await fs.readFile(saved.path, 'utf8'), damaged);
  assert.throws(() => h.service.create('p1', { text: '<!-- claudeweb-memory:x -->', source: h.source }), /INVALID_MEMORY_TEXT/);
});

test('registered-project roots and symbolic links cannot redirect memory writes', async t => {
  const h = await fixture(t);
  await assert.rejects(h.service.list('../second'), /MEMORY_PROJECT_NOT_FOUND/);
  const outside = path.join(h.second, 'CLAUDE.md'); await fs.writeFile(outside, 'untouched');
  try { await fs.symlink(h.second, path.join(h.first, '.claude'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return t.skip('symlink permission unavailable'); throw error; }
  await assert.rejects(h.service.list('p1'), /MEMORY_UNSAFE_PATH/);
  await assert.rejects(h.create(), /MEMORY_UNSAFE_PATH/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
});

test('a live save lock rejects a second writer and is removed after successful mutations', async t => {
  const h = await fixture(t); await h.create();
  const lock = path.join(h.first, '.claude', 'claudeweb-memory.lock');
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(h.create('second'), /MEMORY_BUSY/);
  await fs.unlink(lock); await h.create('second');
  await assert.rejects(fs.stat(lock), /ENOENT/);
});
