import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

import { Header, Parser, type ReadEntry } from 'tar';

import {
  TAR_END_OF_ARCHIVE,
  encodeTarFileHeader,
  tarPadding,
} from '@/modules/backup/backup-archive.service.js';
import { createBackupService } from '@/modules/backup/backup.service.js';
import type { BackupDatabaseSnapshot, BackupMergeSelection } from '@/shared/types.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;

const EMPTY_SNAPSHOT: BackupDatabaseSnapshot = {
  version: 1, projects: [], sessions: [], preferences: [], drafts: [], scheduledMessages: [], scheduledTasks: [], providerModels: [], uploadedFiles: [],
};

function transcript(sessionId: string, cwd: string): string {
  return [
    JSON.stringify({ type: 'summary', summary: 'x' }),
    JSON.stringify({ type: 'user', sessionId, cwd, message: { role: 'user', content: 'hello' } }),
    '',
  ].join('\n');
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

async function createHarness(options: { snapshot?: BackupDatabaseSnapshot; known?: string[]; freeBytes?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'backup-service-'));
  const home = path.join(root, 'home');
  const merges: Array<{ snapshot: BackupDatabaseSnapshot; selection: BackupMergeSelection }> = [];
  const restoredFlags: string[] = [];
  const reindexed: string[] = [];
  const announced: string[] = [];
  const service = createBackupService({
    homeDirectory: home,
    claudeHome: path.join(home, '.claude'),
    claudewebHome: path.join(home, '.claudeweb'),
    uploadsDirectory: path.join(home, '.claudeweb', 'backup-imports'),
    database: {
      exportSnapshot: () => options.snapshot ?? EMPTY_SNAPSHOT,
      findKnownProviderSessionIds: (ids) => new Set(ids.filter((id) => options.known?.includes(id))),
      mergeSnapshot: (snapshot, selection) => {
        merges.push({ snapshot, selection });
        return { projects: 0, sessions: selection.restoredSessions.size, preferences: 0, drafts: 0, scheduledMessages: 0, overdueScheduledMessages: 0, scheduledTasks: 0, providerModels: 0, uploadedFiles: 0 };
      },
      restoreSessionFlags: (sessions) => { restoredFlags.push(...sessions.map((session) => session.sessionId)); },
    },
    reindexTranscript: async (filePath) => { reindexed.push(filePath); },
    announceSessions: async (ids) => { announced.push(...ids); },
    freeBytes: async () => options.freeBytes ?? 1e12,
    now: () => new Date('2026-11-14T08:00:00.000Z'),
    logger: { error: () => undefined },
  });
  return { root, home, service, merges, restoredFlags, reindexed, announced };
}

async function exportBackup(harness: Harness, password?: string, projectFiles?: string[]): Promise<Buffer> {
  const { downloadId, fileName } = await harness.service.prepareExport(1, password, projectFiles);
  assert.match(fileName, password ? /^claude-backup-2026-11-14\.tar\.gz\.enc$/ : /^claude-backup-2026-11-14\.tar\.gz$/);
  const ticket = harness.service.takeExportTicket(downloadId);
  const chunks: Buffer[] = [];
  await harness.service.writeExport(ticket, new Writable({
    write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); },
  }));
  return Buffer.concat(chunks);
}

async function listEntries(archive: Buffer): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ strict: true });
    parser.on('entry', (entry: ReadEntry) => {
      const chunks: Buffer[] = [];
      entry.on('data', (chunk: Buffer) => chunks.push(chunk));
      entry.on('end', () => entries.set(entry.path, Buffer.concat(chunks)));
    });
    parser.on('end', () => resolve());
    parser.on('error', reject);
    parser.end(archive);
  });
  return entries;
}

async function upload(harness: Harness, archive: Buffer): Promise<string> {
  const { importId, chunkSize } = await harness.service.createImport(1, { size: archive.length });
  for (let index = 0; index * chunkSize < archive.length; index += 1) {
    await harness.service.writeImportChunk(1, importId, index, archive.subarray(index * chunkSize, (index + 1) * chunkSize));
  }
  return importId;
}

async function waitForState(harness: Harness, importId: string, states: string[]) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const status = harness.service.getImport(1, importId);
    if (states.includes(status.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`import never reached ${states.join('/')}: ${JSON.stringify(harness.service.getImport(1, importId))}`);
}

function tarFile(entryPath: string, content: string | Buffer): Buffer[] {
  const body = Buffer.from(content);
  return [encodeTarFileHeader(entryPath, body.length, new Date('2026-11-01T00:00:00Z')), body, tarPadding(body.length)];
}

const MANIFEST = JSON.stringify({ format: 'claudeweb-backup', version: 1, createdAt: '2026-11-01T00:00:00.000Z', sourceHome: '/home/claudeweb' });

function handMadeArchive(...parts: Buffer[][]): Buffer {
  return gzipSync(Buffer.concat([...tarFile('manifest.json', MANIFEST), ...parts.flat(), TAR_END_OF_ARCHIVE]));
}

function linkEntry(entryPath: string, type: 'SymbolicLink' | 'Link', linkpath: string): Buffer[] {
  const header = new Header({ path: entryPath, type, linkpath, mode: 0o777, size: 0, mtime: new Date(), uid: 0, gid: 0 });
  header.encode();
  return [Buffer.from(header.block as Buffer)];
}

async function sourceHomeWithChats(harness: Harness): Promise<void> {
  await writeTree(path.join(harness.home, '.claude'), {
    'projects/-home-u-proj/aaaa-1111.jsonl': transcript('aaaa-1111', '/home/u/proj'),
    'projects/-home-u-proj/aaaa-1111/subagents/agent-x.jsonl': '{"sessionId":"aaaa-1111"}\n',
    'projects/-home-u-proj/bbbb-2222.jsonl': transcript('bbbb-2222', '/home/u/proj'),
    'projects/-home-u-proj/memory/MEMORY.md': 'remember this',
    'projects/-/cccc-3333.jsonl': transcript('cccc-3333', '/'),
    'file-history/aaaa-1111/checkpoint-1': 'old code',
    'todos/aaaa-1111-agent-aaaa-1111.json': '[]',
    '.credentials.json': '{"claudeAiOauth":{"accessToken":"secret-token"}}',
    'settings.json': '{}',
    'history.jsonl': '{}\n',
  });
  await writeTree(path.join(harness.home, '.claudeweb'), {
    'assets/picture.png': 'png-bytes',
    'auth.db': 'sqlite',
  });
}

const SNAPSHOT: BackupDatabaseSnapshot = {
  ...EMPTY_SNAPSHOT,
  projects: [{ projectId: 'p1', projectPath: '/home/u/proj', customProjectName: 'My project', isStarred: true, isArchived: false }],
  sessions: [{
    sessionId: 'app-aaaa', providerSessionId: 'aaaa-1111', projectPath: '/home/u/proj', customName: 'Renamed chat',
    model: 'opus', effort: 'high', forkedFromSessionId: null, isArchived: true,
    createdAt: '2026-11-01 00:00:00', updatedAt: '2026-11-02 00:00:00',
  }],
  preferences: [{ key: 'theme', value: '"dark"' }],
};

test('export contains transcripts, memory, checkpoints, task lists, images and data, and nothing else', async (t) => {
  const harness = await createHarness({ snapshot: SNAPSHOT });
  t.after(() => rm(harness.root, { recursive: true, force: true }));
  await sourceHomeWithChats(harness);

  const archive = await exportBackup(harness);
  const entries = await listEntries(gunzipSync(archive));
  assert.deepEqual([...entries.keys()].sort(), [
    'claude/file-history/aaaa-1111/checkpoint-1',
    'claude/projects/-/cccc-3333.jsonl',
    'claude/projects/-home-u-proj/aaaa-1111.jsonl',
    'claude/projects/-home-u-proj/aaaa-1111/subagents/agent-x.jsonl',
    'claude/projects/-home-u-proj/bbbb-2222.jsonl',
    'claude/projects/-home-u-proj/memory/MEMORY.md',
    'claude/todos/aaaa-1111-agent-aaaa-1111.json',
    'claudeweb/assets/picture.png',
    'claudeweb/data.json',
    'manifest.json',
  ]);
  assert.equal(JSON.parse(entries.get('manifest.json')!.toString()).format, 'claudeweb-backup');
  assert.deepEqual(JSON.parse(entries.get('claudeweb/data.json')!.toString()), SNAPSHOT);
  assert.ok(!archive.includes(Buffer.from('secret-token')));
  assert.ok(!gunzipSync(archive).includes(Buffer.from('secret-token')), 'Claude credentials must never be exported');
});

test('export download ids are single use', async (t) => {
  const harness = await createHarness();
  t.after(() => rm(harness.root, { recursive: true, force: true }));
  const { downloadId } = await harness.service.prepareExport(1, undefined);
  harness.service.takeExportTicket(downloadId);
  assert.throws(() => harness.service.takeExportTicket(downloadId), { code: 'BACKUP_EXPORT_NOT_FOUND' });
  await assert.rejects(harness.service.prepareExport(1, 'short'), { code: 'BACKUP_PASSWORD_INVALID' });
});

test('export skips symlinks instead of following them', async (t) => {
  const harness = await createHarness();
  t.after(() => rm(harness.root, { recursive: true, force: true }));
  await writeTree(harness.root, { 'outside/secret.txt': 'outside' });
  await mkdir(path.join(harness.home, '.claude', 'projects', '-p'), { recursive: true });
  try {
    await symlink(path.join(harness.root, 'outside'), path.join(harness.home, '.claude', 'projects', '-p', 'link'), 'dir');
  } catch {
    t.skip('symlinks are not available here');
    return;
  }
  const entries = await listEntries(gunzipSync(await exportBackup(harness)));
  assert.ok(![...entries.keys()].some((name) => name.includes('link')));
});

test('preview lists projects, counts sessions, marks existing ones and missing paths', async (t) => {
  const source = await createHarness({ snapshot: SNAPSHOT });
  const target = await createHarness({ known: ['cccc-3333'] });
  t.after(async () => {
    await rm(source.root, { recursive: true, force: true });
    await rm(target.root, { recursive: true, force: true });
  });
  await sourceHomeWithChats(source);
  const archive = await exportBackup(source);
  // bbbb already exists on the new VPS as a transcript file; cccc is already indexed.
  await writeTree(path.join(target.home, '.claude'), { 'projects/-home-u-proj/bbbb-2222.jsonl': 'KEEP' });

  const importId = await upload(target, archive);
  assert.equal(target.service.getImport(1, importId).state, 'uploaded');
  target.service.startPreview(1, importId, undefined);
  const status = await waitForState(target, importId, ['ready', 'failed']);
  assert.equal(status.state, 'ready', JSON.stringify(status.error));
  const preview = status.preview!;
  assert.equal(preview.encrypted, false);
  assert.equal(preview.sourceHome, source.home);
  assert.deepEqual(preview.projects.map((project) => ({
    id: project.id, name: project.name, path: project.path, pathExists: project.pathExists,
    sessions: project.sessionCount, existing: project.existingSessionCount,
  })), [
    { id: '-', name: '-', path: '/', pathExists: true, sessions: 1, existing: 1 },
    { id: '-home-u-proj', name: 'My project', path: '/home/u/proj', pathExists: false, sessions: 2, existing: 1 },
  ]);
  assert.ok(preview.projects[1].newBytes > 0);
  assert.equal(preview.projects[0].newBytes, 0);
  assert.ok(preview.sharedNewBytes > 0);
});

test('import restores new sessions, keeps existing files untouched and skips unselected projects', async (t) => {
  const source = await createHarness({ snapshot: SNAPSHOT });
  const target = await createHarness();
  t.after(async () => {
    await rm(source.root, { recursive: true, force: true });
    await rm(target.root, { recursive: true, force: true });
  });
  await sourceHomeWithChats(source);
  const originalTime = new Date('2026-10-01T12:34:56.789Z');
  await utimes(path.join(source.home, '.claude', 'projects', '-home-u-proj', 'aaaa-1111.jsonl'), originalTime, originalTime);
  const archive = await exportBackup(source);
  await writeTree(path.join(target.home, '.claude'), {
    'projects/-home-u-proj/bbbb-2222.jsonl': 'KEEP',
    'projects/-home-u-proj/memory/MEMORY.md': 'KEEP-MEMORY',
  });

  const importId = await upload(target, archive);
  target.service.startPreview(1, importId, undefined);
  await waitForState(target, importId, ['ready']);
  await assert.rejects(target.service.startApply(1, importId, ['not-in-preview']), { code: 'BACKUP_SELECTION_INVALID' });
  await target.service.startApply(1, importId, ['-home-u-proj']);
  const status = await waitForState(target, importId, ['done', 'failed']);
  assert.equal(status.state, 'done', JSON.stringify(status.error));

  const projects = path.join(target.home, '.claude', 'projects');
  const restored = path.join(projects, '-home-u-proj', 'aaaa-1111.jsonl');
  assert.equal(await readFile(restored, 'utf8'), transcript('aaaa-1111', '/home/u/proj'));
  assert.equal(await readFile(path.join(projects, '-home-u-proj', 'aaaa-1111', 'subagents', 'agent-x.jsonl'), 'utf8'), '{"sessionId":"aaaa-1111"}\n');
  assert.equal(await readFile(path.join(projects, '-home-u-proj', 'bbbb-2222.jsonl'), 'utf8'), 'KEEP');
  assert.equal(await readFile(path.join(projects, '-home-u-proj', 'memory', 'MEMORY.md'), 'utf8'), 'KEEP-MEMORY');
  assert.equal(await readFile(path.join(target.home, '.claude', 'file-history', 'aaaa-1111', 'checkpoint-1'), 'utf8'), 'old code');
  assert.equal(await readFile(path.join(target.home, '.claude', 'todos', 'aaaa-1111-agent-aaaa-1111.json'), 'utf8'), '[]');
  assert.equal(await readFile(path.join(target.home, '.claudeweb', 'assets', 'picture.png'), 'utf8'), 'png-bytes');
  // The unselected project's transcript is not written.
  await assert.rejects(stat(path.join(projects, '-', 'cccc-3333.jsonl')), { code: 'ENOENT' });
  // Restored files keep their original time, rounded down to whole seconds, so they never look newer.
  assert.equal((await stat(restored)).mtime.getTime(), Math.floor(originalTime.getTime() / 1000) * 1000);
  // No temporary files are left next to restored ones, and the upload is gone.
  assert.deepEqual((await readdir(path.join(projects, '-home-u-proj'))).filter((name) => name.endsWith('.tmp')), []);
  assert.deepEqual(await readdir(path.join(target.home, '.claudeweb', 'backup-imports')), []);

  assert.deepEqual(status.result && {
    restoredSessions: status.result.restoredSessions,
    skippedExistingSessions: status.result.skippedExistingSessions,
  }, { restoredSessions: 1, skippedExistingSessions: 1 });
  assert.equal(target.merges.length, 1);
  assert.deepEqual([...target.merges[0].selection.restoredSessions], [['aaaa-1111', restored]]);
  assert.deepEqual([...target.merges[0].selection.projectPaths], ['/home/u/proj']);
  assert.deepEqual(target.reindexed, [restored]);
  assert.deepEqual(target.restoredFlags, ['app-aaaa']);
  assert.deepEqual(target.announced, ['app-aaaa']);
});

test('password-protected backups need the right password before the preview', async (t) => {
  const source = await createHarness({ snapshot: SNAPSHOT });
  const target = await createHarness();
  t.after(async () => {
    await rm(source.root, { recursive: true, force: true });
    await rm(target.root, { recursive: true, force: true });
  });
  await sourceHomeWithChats(source);
  const archive = await exportBackup(source, 'a long passphrase');
  assert.ok(!archive.includes(Buffer.from('hello')), 'chat text must not be readable in an encrypted backup');

  const importId = await upload(target, archive);
  target.service.startPreview(1, importId, undefined);
  let status = await waitForState(target, importId, ['password', 'ready', 'failed']);
  assert.equal(status.state, 'password');
  assert.equal(status.error?.code, 'BACKUP_PASSWORD_REQUIRED');

  target.service.startPreview(1, importId, 'not the passphrase');
  status = await waitForState(target, importId, ['password', 'ready', 'failed']);
  assert.equal(status.state, 'password');
  assert.equal(status.error?.code, 'BACKUP_PASSWORD_WRONG');

  target.service.startPreview(1, importId, 'a long passphrase');
  status = await waitForState(target, importId, ['password', 'ready', 'failed']);
  assert.equal(status.state, 'ready', JSON.stringify(status.error));
  assert.equal(status.encrypted, true);
  await target.service.startApply(1, importId, status.preview!.projects.map((project) => project.id));
  status = await waitForState(target, importId, ['done', 'failed']);
  assert.equal(status.state, 'done', JSON.stringify(status.error));
  assert.equal(status.result?.restoredSessions, 3);
});

for (const [name, archive, code] of [
  ['a parent-directory path', handMadeArchive(tarFile('claude/projects/../../evil.txt', 'x')), 'BACKUP_UNSAFE_ENTRY'],
  ['an absolute path', handMadeArchive(tarFile('/tmp/evil.txt', 'x')), 'BACKUP_UNSAFE_ENTRY'],
  ['a symbolic link', handMadeArchive(linkEntry('claude/projects/-p/link', 'SymbolicLink', '/etc/passwd')), 'BACKUP_UNSAFE_ENTRY'],
  ['a hard link', handMadeArchive(linkEntry('claude/projects/-p/link', 'Link', '/etc/passwd')), 'BACKUP_UNSAFE_ENTRY'],
  ['Claude credentials', handMadeArchive(tarFile('claude/.credentials.json', '{}')), 'BACKUP_UNSAFE_ENTRY'],
  ['a file for a hidden folder of the home folder', handMadeArchive(tarFile('files/.ssh/authorized_keys', 'key')), 'BACKUP_UNSAFE_ENTRY'],
  ['a file at an area root', handMadeArchive(tarFile('claude/projects', 'x')), 'BACKUP_UNSAFE_ENTRY'],
  ['no manifest', gzipSync(Buffer.concat([...tarFile('claude/projects/-p/a.jsonl', '{}'), TAR_END_OF_ARCHIVE])), 'BACKUP_FORMAT_UNKNOWN'],
  ['a zip file', Buffer.from('PK\u0003\u0004 not a backup'), 'BACKUP_FORMAT_UNKNOWN'],
  ['a cut-off file', handMadeArchive(tarFile('claude/projects/-p/a.jsonl', 'x'.repeat(5000))).subarray(0, 60), 'BACKUP_CORRUPTED'],
] as const) {
  test(`an archive with ${name} is refused and writes nothing`, async (t) => {
    const harness = await createHarness();
    t.after(() => rm(harness.root, { recursive: true, force: true }));
    const importId = await upload(harness, archive);
    harness.service.startPreview(1, importId, undefined);
    const status = await waitForState(harness, importId, ['ready', 'failed', 'password']);
    assert.equal(status.state, 'failed');
    assert.equal(status.error?.code, code);
    await assert.rejects(stat(path.join(harness.root, 'evil.txt')), { code: 'ENOENT' });
    await assert.rejects(stat(path.join(harness.home, '.claude', 'projects', '-p')), { code: 'ENOENT' });
    assert.equal(harness.merges.length, 0);
  });
}

test('import refuses to write through a symlinked project folder', async (t) => {
  const harness = await createHarness();
  t.after(() => rm(harness.root, { recursive: true, force: true }));
  const outside = path.join(harness.root, 'outside');
  await mkdir(outside, { recursive: true });
  await mkdir(path.join(harness.home, '.claude', 'projects'), { recursive: true });
  try {
    await symlink(outside, path.join(harness.home, '.claude', 'projects', '-p'), 'dir');
  } catch {
    t.skip('symlinks are not available here');
    return;
  }
  const archive = handMadeArchive(tarFile('claude/projects/-p/memory/MEMORY.md', 'planted'));
  const importId = await upload(harness, archive);
  harness.service.startPreview(1, importId, undefined);
  await waitForState(harness, importId, ['ready']);
  await harness.service.startApply(1, importId, ['-p']);
  const status = await waitForState(harness, importId, ['done', 'failed']);
  assert.equal(status.state, 'failed');
  assert.equal(status.error?.code, 'BACKUP_UNSAFE_ENTRY');
  assert.deepEqual(await readdir(outside), []);
});

test('uploads arrive in order, with the declared size, and need free disk space', async (t) => {
  const harness = await createHarness();
  t.after(() => rm(harness.root, { recursive: true, force: true }));
  const { importId, chunkSize } = await harness.service.createImport(1, { size: chunkSize8MiB() + 10 });
  await assert.rejects(harness.service.writeImportChunk(1, importId, 1, Buffer.alloc(10)), { code: 'BACKUP_CHUNK_OUT_OF_ORDER' });
  await assert.rejects(harness.service.writeImportChunk(1, importId, 0, Buffer.alloc(10)), { code: 'BACKUP_CHUNK_INVALID' });
  await harness.service.writeImportChunk(1, importId, 0, Buffer.alloc(chunkSize));
  // Resending the same piece after a dropped response is fine.
  await harness.service.writeImportChunk(1, importId, 0, Buffer.alloc(chunkSize));
  assert.equal((await harness.service.writeImportChunk(1, importId, 1, Buffer.alloc(10))).received, chunkSize + 10);
  assert.throws(() => harness.service.getImport(2, importId), { code: 'BACKUP_IMPORT_NOT_FOUND' });
  await assert.rejects(harness.service.createImport(1, { size: -1 }), { code: 'BACKUP_SIZE_INVALID' });

  const full = await createHarness({ freeBytes: 1024 });
  t.after(() => rm(full.root, { recursive: true, force: true }));
  await assert.rejects(full.service.createImport(1, { size: 100 }), { code: 'BACKUP_DISK_FULL' });

  await harness.service.cancelImport(1, importId);
  assert.deepEqual(await readdir(path.join(harness.home, '.claudeweb', 'backup-imports')), []);
});

test('a backup from another home folder (WebDesktop) is restored under this home: folders, cwd and rows', async (t) => {
  const harness = await createHarness();
  t.after(() => rm(harness.root, { recursive: true, force: true }));
  const home = path.resolve(harness.home);
  const placed = path.join(home, 'proj');
  const manifest = JSON.stringify({
    format: 'cloudcli-backup', version: 1, createdAt: '2026-11-01T00:00:00.000Z', sourceHome: '/home/wdguest', projectFiles: ['proj'],
  });
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    projects: [{ projectId: 'p1', projectPath: '/home/wdguest/proj', customProjectName: 'Old project', isStarred: false, isArchived: false }],
    sessions: [{ ...SNAPSHOT.sessions[0], projectPath: '/home/wdguest/proj' }],
  };
  const subagent = `${JSON.stringify({ sessionId: 'aaaa-1111', cwd: '/home/wdguest/proj/sub' })}\n${JSON.stringify({ cwd: '/opt/elsewhere' })}\n`;
  const archive = gzipSync(Buffer.concat([
    ...tarFile('manifest.json', manifest),
    ...tarFile('cloudcli/data.json', JSON.stringify(snapshot)),
    ...tarFile('claude/projects/-home-wdguest-proj/aaaa-1111.jsonl', transcript('aaaa-1111', '/home/wdguest/proj')),
    ...tarFile('claude/projects/-home-wdguest-proj/aaaa-1111/subagents/agent-x.jsonl', subagent),
    ...tarFile('files/proj/readme.md', 'project file'),
    ...tarFile('files/other/stray.txt', 'not an exported project'),
    TAR_END_OF_ARCHIVE,
  ]));

  const importId = await upload(harness, archive);
  harness.service.startPreview(1, importId, undefined);
  const ready = await waitForState(harness, importId, ['ready', 'failed']);
  assert.equal(ready.state, 'ready', JSON.stringify(ready.error));
  assert.deepEqual(ready.preview!.relocation, { from: '/home/wdguest', to: home });
  assert.deepEqual(ready.preview!.projects.map((project) => ({ id: project.id, name: project.name, path: project.path, files: project.fileCount })), [
    { id: '-home-wdguest-proj', name: 'Old project', path: placed, files: 1 },
  ]);

  await harness.service.startApply(1, importId, ['-home-wdguest-proj']);
  const done = await waitForState(harness, importId, ['done', 'failed']);
  assert.equal(done.state, 'done', JSON.stringify(done.error));
  const folder = path.join(home, '.claude', 'projects', placed.replace(/[^a-zA-Z0-9]/g, '-'));
  const restored = path.join(folder, 'aaaa-1111.jsonl');
  assert.equal(await readFile(restored, 'utf8'), transcript('aaaa-1111', placed));
  const lines = (await readFile(path.join(folder, 'aaaa-1111', 'subagents', 'agent-x.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines[0].cwd, path.join(placed, 'sub'));
  assert.equal(lines[1].cwd, '/opt/elsewhere', 'paths outside the old home stay as they are');
  assert.equal(await readFile(path.join(placed, 'readme.md'), 'utf8'), 'project file');
  await assert.rejects(stat(path.join(home, 'other')), { code: 'ENOENT' });
  assert.deepEqual([...harness.merges[0].selection.projectPaths], [placed]);
  assert.equal(harness.merges[0].snapshot.projects[0].projectPath, placed);
  assert.equal(harness.merges[0].snapshot.sessions[0].projectPath, placed);
  assert.deepEqual([...harness.merges[0].selection.restoredSessions], [['aaaa-1111', restored]]);
});

test('export can include project folders, which import restores without replacing files', async (t) => {
  const source = await createHarness();
  const target = await createHarness();
  t.after(async () => {
    await rm(source.root, { recursive: true, force: true });
    await rm(target.root, { recursive: true, force: true });
  });
  const project = path.join(source.home, 'proj');
  const hidden = path.join(source.home, '.config');
  const outside = path.join(source.root, 'outside');
  source.service = createBackupService({
    homeDirectory: source.home,
    claudeHome: path.join(source.home, '.claude'),
    claudewebHome: path.join(source.home, '.claudeweb'),
    uploadsDirectory: path.join(source.home, '.claudeweb', 'backup-imports'),
    database: {
      exportSnapshot: () => ({
        ...EMPTY_SNAPSHOT,
        projects: [project, hidden, outside].map((projectPath, index) => ({
          projectId: `p${index}`, projectPath, customProjectName: null, isStarred: false, isArchived: false,
        })),
      }),
      findKnownProviderSessionIds: () => new Set(),
      mergeSnapshot: () => ({ projects: 0, sessions: 0, preferences: 0, drafts: 0, scheduledMessages: 0, overdueScheduledMessages: 0, scheduledTasks: 0, providerModels: 0, uploadedFiles: 0 }),
      restoreSessionFlags: () => undefined,
    },
    reindexTranscript: async () => undefined,
    announceSessions: async () => undefined,
    freeBytes: async () => 1e12,
    now: () => new Date('2026-11-14T08:00:00.000Z'),
    logger: { error: () => undefined },
  });
  await writeTree(source.home, { 'proj/a.txt': 'new a', 'proj/bin/run.sh': '#!/bin/sh\n', 'proj/.git/HEAD': 'ref: main', '.config/x': 'x' });
  await writeTree(source.root, { 'outside/o.txt': 'o' });
  if (process.platform !== 'win32') await (await import('node:fs/promises')).chmod(path.join(project, 'bin', 'run.sh'), 0o755);

  assert.deepEqual(await source.service.listProjectFolders(1), [{ path: project, name: 'proj' }]);
  await assert.rejects(source.service.prepareExport(1, undefined, [project, outside]), { code: 'BACKUP_SELECTION_INVALID' });
  await assert.rejects(source.service.prepareExport(1, undefined, [hidden]), { code: 'BACKUP_SELECTION_INVALID' });
  const archive = await exportBackup(source, undefined, [project]);
  const entries = await listEntries(gunzipSync(archive));
  assert.deepEqual([...entries.keys()].filter((name) => name.startsWith('files/')).sort(), ['files/proj/.git/HEAD', 'files/proj/a.txt', 'files/proj/bin/run.sh']);
  assert.deepEqual(JSON.parse(entries.get('manifest.json')!.toString()).projectFiles, ['proj']);

  await writeTree(target.home, { 'proj/a.txt': 'KEEP' });
  const importId = await upload(target, archive);
  target.service.startPreview(1, importId, undefined);
  const ready = await waitForState(target, importId, ['ready', 'failed']);
  assert.equal(ready.state, 'ready', JSON.stringify(ready.error));
  const listed = ready.preview!.projects.find((candidate) => candidate.id === 'files:proj');
  assert.equal(listed?.fileCount, 2, 'the file that exists here is not counted');
  await target.service.startApply(1, importId, ['files:proj']);
  const done = await waitForState(target, importId, ['done', 'failed']);
  assert.equal(done.state, 'done', JSON.stringify(done.error));
  assert.equal(await readFile(path.join(target.home, 'proj', 'a.txt'), 'utf8'), 'KEEP');
  assert.equal(await readFile(path.join(target.home, 'proj', 'bin', 'run.sh'), 'utf8'), '#!/bin/sh\n');
  assert.equal(await readFile(path.join(target.home, 'proj', '.git', 'HEAD'), 'utf8'), 'ref: main');
  if (process.platform !== 'win32') assert.equal((await stat(path.join(target.home, 'proj', 'bin', 'run.sh'))).mode & 0o777, 0o755);
  assert.equal(done.result?.skippedExistingFiles, 1);
});

test('a backup lists plugins installed from a repository, and the preview says which are missing here', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'backup-plugins-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const make = (home: string, plugins: Array<{ name: string; displayName?: string; repoUrl: string | null; enabled: boolean; bundled: boolean }>) => createBackupService({
    homeDirectory: home,
    claudeHome: path.join(home, '.claude'),
    claudewebHome: path.join(home, '.claudeweb'),
    uploadsDirectory: path.join(home, '.claudeweb', 'backup-imports'),
    database: {
      exportSnapshot: () => EMPTY_SNAPSHOT,
      findKnownProviderSessionIds: () => new Set(),
      mergeSnapshot: () => ({ projects: 0, sessions: 0, preferences: 0, drafts: 0, scheduledMessages: 0, overdueScheduledMessages: 0, scheduledTasks: 0, providerModels: 0, uploadedFiles: 0 }),
      restoreSessionFlags: () => undefined,
    },
    reindexTranscript: async () => undefined,
    announceSessions: async () => undefined,
    freeBytes: async () => 1e12,
    plugins: { list: () => plugins },
    logger: { error: () => undefined },
  });
  const source = make(path.join(root, 'a'), [
    { name: 'notes', displayName: 'Notes', repoUrl: 'https://github.com/example/notes', enabled: false, bundled: false },
    { name: 'shared', repoUrl: 'https://github.com/example/shared', enabled: true, bundled: false },
    { name: 'claude-usage', repoUrl: null, enabled: true, bundled: true },
    { name: 'local-only', repoUrl: null, enabled: true, bundled: false },
  ]);
  const { downloadId } = await source.prepareExport(1, undefined);
  const chunks: Buffer[] = [];
  await source.writeExport(source.takeExportTicket(downloadId), new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); } }));
  const archive = Buffer.concat(chunks);
  const manifest = JSON.parse((await listEntries(gunzipSync(archive))).get('manifest.json')!.toString());
  assert.deepEqual(manifest.plugins, [
    { name: 'notes', displayName: 'Notes', repoUrl: 'https://github.com/example/notes', enabled: false },
    { name: 'shared', displayName: null, repoUrl: 'https://github.com/example/shared', enabled: true },
  ]);

  const target = make(path.join(root, 'b'), [{ name: 'shared', repoUrl: 'https://github.com/example/shared', enabled: true, bundled: false }]);
  const { importId, chunkSize } = await target.createImport(1, { size: archive.length });
  for (let index = 0; index * chunkSize < archive.length; index += 1) {
    await target.writeImportChunk(1, importId, index, archive.subarray(index * chunkSize, (index + 1) * chunkSize));
  }
  target.startPreview(1, importId, undefined);
  let status = target.getImport(1, importId);
  for (let attempt = 0; attempt < 500 && status.state !== 'ready' && status.state !== 'failed'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    status = target.getImport(1, importId);
  }
  assert.equal(status.state, 'ready', JSON.stringify(status.error));
  assert.deepEqual(status.preview!.plugins.map((plugin) => [plugin.name, plugin.installed, plugin.enabled]), [['notes', false, false], ['shared', true, true]]);
});

function chunkSize8MiB(): number {
  return 8 * 1024 * 1024;
}
