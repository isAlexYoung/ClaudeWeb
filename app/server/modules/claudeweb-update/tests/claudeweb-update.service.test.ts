import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createClaudeWebUpdateService } from '@/modules/claudeweb-update/claudeweb-update.service.js';

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'claudeweb-update-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('status reports the installed prebuilt version and the updater progress, and no support outside WebDesktop', async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, 'claudeweb.json'), JSON.stringify({ version: '1.0.0' }));
    await writeFile(path.join(directory, 'status.json'), JSON.stringify({ state: 'downloading', version: '1.0.1' }));
    const service = createClaudeWebUpdateService({ appRoot: directory, socketPath: undefined, statusPath: path.join(directory, 'status.json') });
    assert.deepEqual(await service.status(), {
      supported: false,
      installed: '1.0.0',
      status: { state: 'downloading', version: '1.0.1' },
    });
    await assert.rejects(service.check(), { code: 'CLAUDEWEB_UPDATE_UNSUPPORTED' });
  });
});

test('a ClaudeWeb built on the VPS has no prebuilt version and an unreadable status reads as idle', async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, 'status.json'), '{broken');
    const service = createClaudeWebUpdateService({ appRoot: directory, socketPath: undefined, statusPath: path.join(directory, 'status.json') });
    const status = await service.status();
    assert.equal(status.installed, null);
    assert.deepEqual(status.status, { state: 'idle' });
  });
});

test('check and update relay one request each over the root socket and surface its refusal code', { skip: process.platform === 'win32' }, async () => {
  await withDirectory(async (directory) => {
    const socketPath = path.join(directory, 'update.sock');
    const received: unknown[] = [];
    const server = net.createServer((connection) => {
      let data = '';
      connection.setEncoding('utf8');
      connection.on('data', (chunk) => {
        data += chunk;
        if (!data.includes('\n')) return;
        const request = JSON.parse(data.trim()) as { op: string; version?: string };
        received.push(request);
        const reply = request.op === 'check'
          ? { ok: true, installed: '1.0.0', webdesktop: '3.0.1', latest: '1.0.1', newer: [{ version: '1.0.1', notes: 'n', requires_webdesktop: '3.0.1', compatible: true, download_bytes: 5 }] }
          : request.version === '1.0.1' ? { ok: true, started: true } : { ok: false, error: 'CLAUDEWEB_NOT_NEWER' };
        connection.end(`${JSON.stringify(reply)}\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const service = createClaudeWebUpdateService({ appRoot: directory, socketPath, statusPath: undefined });
      assert.equal((await service.status()).supported, true);
      const offer = await service.check();
      assert.equal(offer.latest, '1.0.1');
      assert.equal(offer.newer[0].compatible, true);
      assert.deepEqual(await service.update('1.0.1'), { started: true, version: '1.0.1' });
      await assert.rejects(service.update('0.9.0'), { code: 'CLAUDEWEB_NOT_NEWER' });
      assert.deepEqual(received, [{ op: 'check' }, { op: 'update', version: '1.0.1' }, { op: 'update', version: '0.9.0' }]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('update validates the version before asking root, and a plain file is not the updater socket', async () => {
  await withDirectory(async (directory) => {
    const socketPath = path.join(directory, 'update.sock');
    await writeFile(socketPath, '');
    const service = createClaudeWebUpdateService({
      appRoot: directory,
      socketPath,
      statusPath: undefined,
      request: async () => ({ ok: false, error: '<script>' }),
    });
    await assert.rejects(service.update('../1'), { code: 'CLAUDEWEB_VERSION_INVALID' });
    await assert.rejects(service.check(), { code: 'CLAUDEWEB_UPDATE_UNSUPPORTED' });
  });
});
