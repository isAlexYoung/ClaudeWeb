import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import assetsRoutes from '@/modules/assets/assets.routes.js';
import {
  ATTACHMENT_CHUNK_BYTES,
  chunkedUploadService,
  diskReserveFor,
  diskRoomError,
  getUploadTempDir,
  MAX_ATTACHMENT_BYTES,
} from '@/modules/assets/services/chunked-upload.service.js';
import { contentDispositionFor, projectFilesService } from '@/modules/assets/services/project-files.service.js';
import { indexOlderUploads, originalNameFromStoredName } from '@/modules/assets/services/upload-index.service.js';
import { closeConnection, getConnection, initializeDatabase, uploadedFilesDb } from '@/modules/database/index.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';

/** Runs with an empty database and a temporary home folder (so `~/.claudeweb/assets` is private to the test). */
async function withIsolatedHome(run: (home: string) => Promise<void>): Promise<void> {
  const saved = { db: process.env.DATABASE_PATH, home: process.env.HOME, profile: process.env.USERPROFILE };
  const home = await mkdtemp(path.join(tmpdir(), 'uploaded-files-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(home, 'auth.db');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();
  try {
    await run(home);
  } finally {
    await chunkedUploadService.resetForTests();
    closeConnection();
    for (const [key, value] of [['DATABASE_PATH', saved.db], ['HOME', saved.home], ['USERPROFILE', saved.profile]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
}

const assetsDir = (home: string) => path.join(home, '.claudeweb', 'assets');

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

test('a file sent in pieces lands in the assets folder and on its project page', async () => {
  await withIsolatedHome(async (home) => {
    const projectPath = path.join(home, 'project');
    const size = ATTACHMENT_CHUNK_BYTES + 5;
    const bytes = Buffer.alloc(size, 7);
    bytes[size - 1] = 9;

    const { uploadId, chunkSize } = await chunkedUploadService.create({
      name: '季度 report.pdf', size, mimeType: 'application/pdf', projectPath,
    });
    assert.equal(chunkSize, ATTACHMENT_CHUNK_BYTES);
    await chunkedUploadService.writeChunk(uploadId, 0, bytes.subarray(0, chunkSize));
    // A resent piece (lost response) is accepted again.
    await chunkedUploadService.writeChunk(uploadId, 0, bytes.subarray(0, chunkSize));
    await rejectsWith(chunkedUploadService.complete(uploadId), 'UPLOAD_INCOMPLETE');
    await chunkedUploadService.writeChunk(uploadId, 1, bytes.subarray(chunkSize));
    const attachment = await chunkedUploadService.complete(uploadId);

    assert.equal(attachment.name, '季度 report.pdf');
    assert.equal(attachment.size, size);
    assert.equal(path.dirname(attachment.path), assetsDir(home).replace(/\\/g, '/'));
    assert.match(path.basename(attachment.path), /^\d+-\d+-___report\.pdf$/);
    assert.deepEqual(await readFile(attachment.path), bytes);
    assert.deepEqual(await readdir(getUploadTempDir()), []);

    const files = projectFilesService.list(projectPath);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, '季度 report.pdf');
    assert.equal(files[0].size, size);
    assert.equal(files[0].mimeType, 'application/pdf');
    assert.equal(files[0].exists, true);
    assert.match(files[0].uploadedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

test('uploads are refused when too large, out of order, the wrong size or unknown', async () => {
  await withIsolatedHome(async () => {
    await rejectsWith(chunkedUploadService.create({ name: 'big.bin', size: MAX_ATTACHMENT_BYTES + 1 }), 'UPLOAD_TOO_LARGE');
    await rejectsWith(chunkedUploadService.create({ name: '', size: 3 }), 'UPLOAD_NAME_REQUIRED');
    await rejectsWith(chunkedUploadService.create({ name: 'x', size: -1 }), 'UPLOAD_SIZE_INVALID');

    // An empty file has no pieces and completes at once.
    const empty = await chunkedUploadService.create({ name: 'empty.txt', size: 0 });
    assert.equal((await chunkedUploadService.complete(empty.uploadId)).size, 0);

    const { uploadId } = await chunkedUploadService.create({ name: 'two.bin', size: ATTACHMENT_CHUNK_BYTES + 1 });
    await rejectsWith(chunkedUploadService.writeChunk(uploadId, 1, Buffer.alloc(1)), 'UPLOAD_CHUNK_OUT_OF_ORDER');
    await rejectsWith(chunkedUploadService.writeChunk(uploadId, 0, Buffer.alloc(3)), 'UPLOAD_CHUNK_INVALID');
    await rejectsWith(chunkedUploadService.writeChunk(uploadId, 2, Buffer.alloc(1)), 'UPLOAD_CHUNK_INVALID');
    await rejectsWith(chunkedUploadService.writeChunk('missing', 0, Buffer.alloc(1)), 'UPLOAD_NOT_FOUND');

    await chunkedUploadService.cancel(uploadId);
    await rejectsWith(chunkedUploadService.complete(uploadId), 'UPLOAD_NOT_FOUND');
    assert.deepEqual(await readdir(getUploadTempDir()), []);
  });
});

test('project files can be downloaded under their original name and deleted', async () => {
  await withIsolatedHome(async (home) => {
    const projectPath = path.join(home, 'project');
    const { uploadId } = await chunkedUploadService.create({ name: 'notes.txt', size: 5, projectPath });
    await chunkedUploadService.writeChunk(uploadId, 0, Buffer.from('hello'));
    const attachment = await chunkedUploadService.complete(uploadId);
    const storedName = path.basename(attachment.path);

    const opened = await projectFilesService.open(storedName);
    assert.equal(opened.name, 'notes.txt');
    assert.equal(opened.size, 5);
    opened.stream.destroy();

    await rejectsWith(projectFilesService.open('../auth.db'), 'PROJECT_FILE_NOT_FOUND');
    await rejectsWith(projectFilesService.open('not-recorded.txt'), 'PROJECT_FILE_NOT_FOUND');

    assert.deepEqual(await projectFilesService.remove(storedName), { deleted: true });
    await assert.rejects(stat(attachment.path));
    assert.deepEqual(projectFilesService.list(projectPath), []);
  });
});

test('the download header carries non-ASCII names', () => {
  assert.equal(
    contentDispositionFor('报告 "v2".pdf'),
    `attachment; filename="__ _v2_.pdf"; filename*=UTF-8''${encodeURIComponent('报告 "v2".pdf')}`,
  );
});

test('older uploads are matched to the project whose conversation used them', async () => {
  await withIsolatedHome(async (home) => {
    const projectPath = path.join(home, 'project');
    const transcriptPath = path.join(home, 'session-1.jsonl');
    await mkdir(assetsDir(home), { recursive: true });
    await writeFile(path.join(assetsDir(home), '1763000000000-11-report.pdf'), 'pdf');
    await writeFile(path.join(assetsDir(home), '1763000000000-12-unused.png'), 'png');
    const reference = `${assetsDir(home).replace(/\\/g, '/')}/1763000000000-11-report.pdf (original name: 年度 report.pdf)`;
    await writeFile(transcriptPath, [
      JSON.stringify({ type: 'summary' }),
      JSON.stringify({ type: 'user', message: { content: `<files_input>\n1. ${reference}\n</files_input>` } }),
      '',
    ].join('\n'));
    getConnection().prepare(`INSERT INTO projects (project_id, project_path) VALUES ('p1', ?)`).run(normalizeProjectPath(projectPath));
    getConnection().prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, project_path, jsonl_path) VALUES ('s1', 'claude', 's1', ?, ?)`,
    ).run(normalizeProjectPath(projectPath), transcriptPath);

    assert.equal(await indexOlderUploads(), 2);
    assert.equal(await indexOlderUploads(), 0);

    const listed = projectFilesService.list(projectPath);
    assert.deepEqual(listed.map((file) => [file.storedName, file.name, file.sessionId, file.mimeType]), [
      ['1763000000000-11-report.pdf', '年度 report.pdf', 's1', 'application/pdf'],
    ]);
    assert.equal(listed[0].uploadedAt, new Date(1763000000000).toISOString());
    const unused = uploadedFilesDb.get('1763000000000-12-unused.png');
    assert.equal(unused?.project_path, null);
    assert.equal(unused?.original_name, 'unused.png');
  });
});

test('the original name is recovered from the stored name', () => {
  assert.equal(originalNameFromStoredName('1763000000000-123456-my_file.txt'), 'my_file.txt');
  assert.equal(originalNameFromStoredName('plain.txt'), 'plain.txt');
});

test('a 255-character original filename completes without exceeding filesystem limits', async () => {
  await withIsolatedHome(async () => {
    const name = `${'a'.repeat(251)}.pdf`;
    const { uploadId } = await chunkedUploadService.create({ name, size: 0 });
    const attachment = await chunkedUploadService.complete(uploadId);
    assert.equal(attachment.name, name);
    assert.ok(Buffer.byteLength(path.basename(attachment.path)) <= 255);
    assert.equal(path.extname(attachment.path), '.pdf');
    assert.equal((await stat(attachment.path)).size, 0);
  });
});

test('download headers percent-encode RFC 5987 special characters', () => {
  assert.ok(contentDispositionFor("team's (draft).txt").endsWith("filename*=UTF-8''team%27s%20%28draft%29.txt"));
});

test('the HTTP upload route accepts a complete 256 MiB file in 8 MiB pieces with identical bytes', async () => {
  await withIsolatedHome(async (home) => {
    const app = express();
    app.use(express.json());
    app.use('/api/assets', assetsRoutes);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/api/assets`;
    try {
      const start = await fetch(`${endpoint}/uploads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'maximum.bin', size: MAX_ATTACHMENT_BYTES, projectPath: path.join(home, 'project') }),
      });
      assert.equal(start.status, 200);
      const { uploadId } = await start.json() as { uploadId: string };
      const piece = Buffer.alloc(ATTACHMENT_CHUNK_BYTES, 73);
      const expected = createHash('sha256');
      for (let index = 0; index < MAX_ATTACHMENT_BYTES / piece.length; index += 1) {
        const response = await fetch(`${endpoint}/uploads/${uploadId}/chunks/${index}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: piece,
        });
        assert.equal(response.status, 200);
        await response.json();
        expected.update(piece);
      }
      const finish = await fetch(`${endpoint}/uploads/${uploadId}/complete`, { method: 'POST' });
      assert.equal(finish.status, 200);
      const { attachment } = await finish.json() as { attachment: { path: string; size: number } };
      assert.equal(attachment.size, MAX_ATTACHMENT_BYTES);
      assert.equal((await stat(attachment.path)).size, MAX_ATTACHMENT_BYTES);
      const actual = createHash('sha256');
      for await (const chunk of createReadStream(attachment.path)) actual.update(chunk);
      assert.equal(actual.digest('hex'), expected.digest('hex'));
      assert.deepEqual(await readdir(getUploadTempDir()), []);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

const MB = 1024 * 1024;

test('the free space kept on the disk is a tenth of it, at most 512 MB', () => {
  assert.equal(diskReserveFor(982 * MB), Math.floor(98.2 * MB));
  assert.equal(diskReserveFor(40 * 1024 * MB), 512 * MB);
});

test('a small file fits on the 1 GB guest disk that a fixed 512 MB reserve refused', () => {
  // The guest home as a user reported it: 982 MB, 306 MB free.
  const guestHome = { available: 306 * MB, total: 982 * MB };
  assert.equal(diskRoomError(guestHome, 300 * 1024), null);
  assert.equal(diskRoomError(guestHome, 200 * MB), null);

  const tooBig = diskRoomError(guestHome, 250 * MB);
  assert.equal(tooBig?.code, 'UPLOAD_DISK_FULL');
  assert.equal(tooBig?.statusCode, 507);
  assert.match(tooBig?.message ?? '', /306 MB free, 348 MB needed \(the file plus 98 MB kept free\)/);
});

test('an unreadable disk does not block uploads', () => {
  assert.equal(diskRoomError(null, 100 * MB), null);
});
