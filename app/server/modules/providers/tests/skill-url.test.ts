import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';

import { loadSkillsFromGitHub } from '@/modules/providers/services/skill-url.service.js';
import { providerSkillsService } from '@/modules/providers/services/skills.service.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import { AppError } from '@/shared/utils.js';

const sha = 'a'.repeat(40);
const markdown = '---\nname: linked-skill\ndescription: Imported example\n---\n\nUse scripts/run.py.\n';
const originalFetch = globalThis.fetch;
const entry = (filePath: string, mode = '100644', size = 100) => ({ path: filePath, type: 'blob', mode, size });

function mockGitHub(files = [entry('skills/example/SKILL.md'), entry('skills/example/scripts/run.py')], options = { truncated: false }) {
  const requests: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(init?.redirect, 'error');
    if (url.includes('/commits/')) return Response.json({ sha });
    if (url.includes('/git/trees/')) return Response.json({ tree: files, truncated: options.truncated });
    assert.ok(url.startsWith(`https://raw.githubusercontent.com/owner/repo/${sha}/`), 'supporting files use the same immutable revision');
    return new Response(url.endsWith('SKILL.md') ? markdown : 'print("linked")\n');
  }) as typeof fetch;
  return requests;
}

test('skill URL import keeps scripts, pins one revision and installs using the normal provider', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'skill-url-'));
  const home = os.homedir;
  os.homedir = () => temp;
  const requests = mockGitHub();
  try {
    const installed = await providerSkillsService.importProviderSkills('claude', 'https://github.com/owner/repo/tree/main/skills/example');
    assert.equal(installed.length, 1);
    assert.match(await readFile(path.join(temp, '.claude/skills/linked-skill/SKILL.md'), 'utf8'), /name: linked-skill/);
    assert.equal(await readFile(path.join(temp, '.claude/skills/linked-skill/scripts/run.py'), 'utf8'), 'print("linked")\n');
    assert.equal(requests.length, 4);
  } finally { globalThis.fetch = originalFetch; os.homedir = home; await rm(temp, { recursive: true, force: true }); }
});

test('repository, blob and raw links resolve skills and retain supporting files', async () => {
  try {
    for (const url of ['https://github.com/owner/repo', 'https://github.com/owner/repo/blob/main/skills/example/SKILL.md', 'https://raw.githubusercontent.com/owner/repo/main/skills/example/SKILL.md']) {
      mockGitHub();
      const input = await loadSkillsFromGitHub(url);
      assert.equal(input.entries[0].content, markdown);
      assert.equal(input.entries[0].files?.[0].relativePath, 'scripts/run.py');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('unsupported URLs never initiate network requests', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected network'); }) as typeof fetch;
  try {
    for (const url of ['http://github.com/owner/repo', 'https://127.0.0.1/SKILL.md', 'https://github.com.evil.test/owner/repo', 'https://user:secret@github.com/owner/repo', 'https://github.com/owner/repo/issues/1', 'https://github.com/owner/repo/blob/main/not-a-skill.txt']) await assert.rejects(loadSkillsFromGitHub(url), AppError);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('rejects oversized or truncated downloads, symlinks, traversal and empty folders', async () => {
  try {
    for (const files of [[], [entry('skills/example/SKILL.md', '120000')], [entry('skills/example/SKILL.md'), entry('skills/example/../../escape')], [entry('skills/example/SKILL.md', '100644', 3 * 1024 * 1024)]]) {
      mockGitHub(files);
      await assert.rejects(loadSkillsFromGitHub('https://github.com/owner/repo/tree/main/skills/example'), AppError);
    }
    mockGitHub(undefined, { truncated: true });
    await assert.rejects(loadSkillsFromGitHub('https://github.com/owner/repo'), /too large/);
    globalThis.fetch = (async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))) as typeof fetch;
    await assert.rejects(loadSkillsFromGitHub('https://github.com/owner/repo'), /size limit/);
  } finally { globalThis.fetch = originalFetch; }
});

test('a repository root skill does not absorb nested skills as supporting files', async () => {
  mockGitHub([entry('SKILL.md'), entry('scripts/root.py'), entry('nested/SKILL.md'), entry('nested/scripts/run.py')]);
  try {
    const input = await loadSkillsFromGitHub('https://github.com/owner/repo');
    assert.equal(input.entries.length, 2);
    assert.deepEqual(input.entries[0].files?.map(file => file.relativePath), ['scripts/root.py']);
    assert.deepEqual(input.entries[1].files?.map(file => file.relativePath), ['scripts/run.py']);
  } finally { globalThis.fetch = originalFetch; }
});

test('GitHub failures and redirects cannot produce a partial install', async () => {
  try {
    for (const status of [302, 403, 404]) {
      globalThis.fetch = (async () => new Response('', { status })) as typeof fetch;
      await assert.rejects(loadSkillsFromGitHub('https://github.com/owner/repo'), AppError);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('skill import route validates URL input and forwards only the trimmed link', async () => {
  const originalImport = providerSkillsService.importProviderSkills;
  let calls = 0;
  providerSkillsService.importProviderSkills = async (provider, url) => {
    assert.equal(provider, 'claude'); assert.equal(url, 'https://github.com/owner/repo'); calls++; return [];
  };
  const app = express().use(express.json()).use('/api/providers', providerRouter);
  app.use((error: AppError, _req: Request, res: ExpressResponse, _next: NextFunction) => { res.status(error.statusCode || 500).json({ success: false }); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/providers/claude/skills/import`;
  try {
    for (const body of [{}, { url: 42 }, { url: ' ' }, { url: 'x'.repeat(2049) }]) {
      assert.equal((await originalFetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
    }
    const response = await originalFetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: '  https://github.com/owner/repo  ' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { provider: 'claude', skills: [] } });
    assert.equal(calls, 1);
  } finally { providerSkillsService.importProviderSkills = originalImport; await new Promise<void>(resolve => server.close(() => resolve())); }
});
