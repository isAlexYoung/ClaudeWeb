import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareProjectMemory } from '../project-memory.service.js';

test('memory creates the project instruction file once, preserves edits and tolerates concurrent opens', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-memory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const results = await Promise.all([prepareProjectMemory(root, fs), prepareProjectMemory(root, fs)]);
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(results[0].path, path.join(root, 'CLAUDE.md'));
  await fs.writeFile(results[0].path, 'Keep my existing project rules');
  const existing = await prepareProjectMemory(root, fs);
  assert.equal(existing.created, false);
  assert.equal(await fs.readFile(existing.path, 'utf8'), 'Keep my existing project rules');
});

test('memory rejects a CLAUDE.md directory instead of treating it as an editable file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-memory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'CLAUDE.md'));
  await assert.rejects(prepareProjectMemory(root, fs));
});
