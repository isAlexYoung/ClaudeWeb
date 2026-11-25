import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { backupDb, closeConnection, getConnection, initializeDatabase } from '@/modules/database/index.js';
import type { BackupDatabaseSnapshot } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

async function withIsolatedDatabase(run: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'backup-db-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  // An existing (empty) file stops the one-time copy of a developer's legacy database.
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();
  try {
    await run();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const SNAPSHOT: BackupDatabaseSnapshot = {
  version: 1,
  projects: [
    { projectId: 'old-one', projectPath: '/p/one', customProjectName: 'Project One', isStarred: true, isArchived: false },
    { projectId: 'old-two', projectPath: '/p/two', customProjectName: 'Project Two', isStarred: false, isArchived: true },
  ],
  sessions: [
    {
      sessionId: 'app-1', providerSessionId: 'prov-1', projectPath: '/p/one', customName: 'My chat', model: 'opus',
      effort: 'high', forkedFromSessionId: null, isArchived: true, createdAt: '2026-10-01 10:00:00', updatedAt: '2026-11-01 10:00:00',
    },
    {
      sessionId: 'app-2', providerSessionId: 'prov-2', projectPath: '/p/two', customName: 'Not restored', model: null,
      effort: null, forkedFromSessionId: null, isArchived: false, createdAt: null, updatedAt: null,
    },
  ],
  preferences: [
    { key: 'theme', value: '"light"' },
    { key: 'workspaceFonts', value: '{"ui":"inter"}' },
  ],
  drafts: [
    { scope: 'project:old-one', text: 'project draft', queuedMessage: null, updatedAt: null },
    { scope: 'app-1', text: 'session draft', queuedMessage: null, updatedAt: null },
    { scope: 'app-2', text: 'other draft', queuedMessage: null, updatedAt: null },
  ],
  scheduledMessages: [
    {
      id: 'due', sessionId: 'app-1', content: 'late', options: '{}', scheduledFor: '2026-11-10 09:00:00',
      status: 'pending', failureReason: null, createdAt: null, updatedAt: null,
    },
    {
      id: 'future', sessionId: 'app-1', content: 'later', options: '{}', scheduledFor: '2030-01-01T00:00:00.000Z',
      status: 'pending', failureReason: null, createdAt: null, updatedAt: null,
    },
    {
      id: 'other', sessionId: 'app-2', content: 'x', options: '{}', scheduledFor: '2030-01-01T00:00:00.000Z',
      status: 'pending', failureReason: null, createdAt: null, updatedAt: null,
    },
  ],
  scheduledTasks: [{
    id: 'task-1', name: 'Nightly', projectPath: '/p/one', prompt: 'check', schedule: '{"kind":"daily","time":"09:00"}',
    timezone: 'Asia/Shanghai', model: null, permission: 'edits', toolsSettings: '{}', createdAt: null,
  }],
  providerModels: [{ modelId: 'custom-model', modelName: 'Custom', sortOrder: 0, effortValues: null, effortDefault: null }],
  uploadedFiles: [
    {
      storedName: '1763000000000-1-report.pdf', originalName: 'report.pdf', mimeType: 'application/pdf', size: 12,
      projectPath: '/p/one', sessionId: 'app-1', createdAt: '2026-11-01 10:00:00',
    },
    {
      storedName: '1763000000000-2-known.txt', originalName: 'known.txt', mimeType: 'text/plain', size: 3,
      projectPath: '/p/two', sessionId: null, createdAt: null,
    },
  ],
  artefacts: [
    {
      id: 'art-1', kind: 'sheet', title: 'Budget', fileName: 'art-1.json', sessionId: 'app-1', pinned: true,
      createdAt: '2026-11-01 10:00:00', updatedAt: '2026-11-02 10:00:00', openedAt: '2026-11-03 10:00:00',
    },
    {
      id: 'art-2', kind: 'doc', title: 'Notes', fileName: 'art-2.md', sessionId: 'app-2', pinned: false,
      createdAt: null, updatedAt: null, openedAt: null,
    },
    {
      id: 'art-known', kind: 'whiteboard', title: 'From backup', fileName: 'art-known.excalidraw', sessionId: null, pinned: false,
      createdAt: null, updatedAt: null, openedAt: null,
    },
  ],
};

test('merge fills gaps without replacing what the new installation already has', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    const userId = Number(db.prepare(`INSERT INTO users (username, password_hash) VALUES ('owner', 'x')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO projects (project_id, project_path, custom_project_name) VALUES ('new-one', ?, 'one')`).run(normalizeProjectPath('/p/one'));
    db.prepare(`INSERT INTO user_preferences (user_id, preference_key, preference_value) VALUES (?, 'theme', '"dark"')`).run(userId);
    // The watcher indexed the restored transcript under its provider id before the merge ran.
    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path)
       VALUES ('prov-1', 'claude', 'prov-1', 'hello', ?, '/h/.claude/projects/-p-one/prov-1.jsonl')`,
    ).run(normalizeProjectPath('/p/one'));
    // This installation already lists one of the uploads, under its own project.
    db.prepare(
      `INSERT INTO uploaded_files (stored_name, original_name, size, project_path) VALUES ('1763000000000-2-known.txt', 'known.txt', 3, ?)`,
    ).run(normalizeProjectPath('/p/one'));

    const result = backupDb.mergeSnapshot(SNAPSHOT, {
      userId,
      projectPaths: new Set(['/p/one']),
      restoredSessions: new Map([['prov-1', '/h/.claude/projects/-p-one/prov-1.jsonl']]),
      now: new Date('2026-11-14T08:00:00Z'),
    });
    assert.deepEqual(result, {
      projects: 0, sessions: 1, preferences: 1, drafts: 2, scheduledMessages: 2, overdueScheduledMessages: 1, scheduledTasks: 1, providerModels: 1, uploadedFiles: 1, artefacts: 0,
    });
    assert.deepEqual(db.prepare(`SELECT stored_name, original_name, project_path, session_id, created_at FROM uploaded_files ORDER BY stored_name`).all(), [
      {
        stored_name: '1763000000000-1-report.pdf', original_name: 'report.pdf', project_path: normalizeProjectPath('/p/one'),
        session_id: 'app-1', created_at: '2026-11-01 10:00:00',
      },
      {
        stored_name: '1763000000000-2-known.txt', original_name: 'known.txt', project_path: normalizeProjectPath('/p/one'),
        session_id: null, created_at: (db.prepare(`SELECT created_at FROM uploaded_files WHERE stored_name = '1763000000000-2-known.txt'`).get() as { created_at: string }).created_at,
      },
    ]);
    // Scheduled tasks come back paused, with no next run.
    assert.deepEqual(db.prepare(`SELECT id, user_id, enabled, next_run_at FROM scheduled_tasks`).all(), [
      { id: 'task-1', user_id: userId, enabled: 0, next_run_at: null },
    ]);

    const sessions = db.prepare(`SELECT session_id, provider_session_id, custom_name, isArchived, jsonl_path, model, updated_at FROM sessions ORDER BY session_id`).all();
    assert.deepEqual(sessions, [{
      session_id: 'app-1', provider_session_id: 'prov-1', custom_name: 'My chat', isArchived: 1,
      jsonl_path: '/h/.claude/projects/-p-one/prov-1.jsonl', model: 'opus', updated_at: '2026-11-01 10:00:00',
    }]);

    // The existing project keeps its id and takes the backup's name and star (it still had the defaults).
    assert.deepEqual(db.prepare(`SELECT project_id, custom_project_name, isStarred FROM projects`).all(), [
      { project_id: 'new-one', custom_project_name: 'Project One', isStarred: 1 },
    ]);
    assert.deepEqual(db.prepare(`SELECT preference_key, preference_value FROM user_preferences ORDER BY preference_key`).all(), [
      { preference_key: 'theme', preference_value: '"dark"' },
      { preference_key: 'workspaceFonts', preference_value: '{"ui":"inter"}' },
    ]);
    assert.deepEqual(db.prepare(`SELECT draft_scope, draft_text FROM session_drafts ORDER BY draft_scope`).all(), [
      { draft_scope: 'app-1', draft_text: 'session draft' },
      { draft_scope: 'project:new-one', draft_text: 'project draft' },
    ]);
    assert.deepEqual(db.prepare(`SELECT id, status, failure_reason FROM scheduled_messages ORDER BY id`).all(), [
      { id: 'due', status: 'failed', failure_reason: 'BACKUP_RESTORED_OVERDUE' },
      { id: 'future', status: 'pending', failure_reason: null },
    ]);
    assert.deepEqual(db.prepare(`SELECT COUNT(*) AS n FROM provider_models WHERE model_id = 'custom-model'`).get(), { n: 1 });

    // A second import of the same backup changes nothing.
    const again = backupDb.mergeSnapshot(SNAPSHOT, {
      userId, projectPaths: new Set(['/p/one']), restoredSessions: new Map(), now: new Date('2026-11-14T08:00:00Z'),
    });
    assert.deepEqual(again, { projects: 0, sessions: 0, preferences: 0, drafts: 0, scheduledMessages: 0, overdueScheduledMessages: 0, scheduledTasks: 0, providerModels: 0, uploadedFiles: 0, artefacts: 0 });
  });
});

test('missing projects are created with their backup id, name and flags', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    const userId = Number(db.prepare(`INSERT INTO users (username, password_hash) VALUES ('owner', 'x')`).run().lastInsertRowid);
    const result = backupDb.mergeSnapshot(SNAPSHOT, {
      userId, projectPaths: new Set(['/p/two']), restoredSessions: new Map(), now: new Date('2026-11-14T08:00:00Z'),
    });
    assert.equal(result.projects, 1);
    assert.deepEqual(db.prepare(`SELECT project_id, project_path, custom_project_name, isArchived FROM projects`).all(), [
      { project_id: 'old-two', project_path: normalizeProjectPath('/p/two'), custom_project_name: 'Project Two', isArchived: 1 },
    ]);
  });
});

test('export reads back the rows and restoreSessionFlags undoes indexer changes', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    const userId = Number(db.prepare(`INSERT INTO users (username, password_hash) VALUES ('owner', 'x')`).run().lastInsertRowid);
    backupDb.mergeSnapshot(SNAPSHOT, {
      userId,
      projectPaths: new Set(['/p/one']),
      restoredSessions: new Map([['prov-1', '/h/prov-1.jsonl']]),
      now: new Date('2026-11-14T08:00:00Z'),
    });
    db.prepare(`UPDATE sessions SET isArchived = 0, custom_name = 'title from transcript' WHERE session_id = 'app-1'`).run();
    backupDb.restoreSessionFlags([SNAPSHOT.sessions[0]]);
    const exported = backupDb.exportSnapshot(userId);
    assert.deepEqual(exported.sessions.map((session) => [session.sessionId, session.customName, session.isArchived]), [
      ['app-1', 'My chat', true],
    ]);
    assert.deepEqual(exported.preferences.map((preference) => preference.key), ['theme', 'workspaceFonts']);
    assert.deepEqual(exported.scheduledTasks.map((task) => [task.id, task.name, task.timezone]), [['task-1', 'Nightly', 'Asia/Shanghai']]);
    assert.deepEqual(exported.uploadedFiles.map((file) => [file.storedName, file.originalName, file.sessionId]), [
      ['1763000000000-1-report.pdf', 'report.pdf', 'app-1'],
      ['1763000000000-2-known.txt', 'known.txt', null],
    ]);
    assert.deepEqual(backupDb.findKnownProviderSessionIds(['prov-1', 'prov-2', 'app-1']), new Set(['prov-1', 'app-1']));
    assert.deepEqual(exported.artefacts, []);
  });
});

test('artefacts come back for the importing account, linked to a restored chat, never replacing one already here', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    const userId = Number(db.prepare(`INSERT INTO users (username, password_hash) VALUES ('owner', 'x')`).run().lastInsertRowid);
    db.prepare(
      `INSERT INTO artefacts (id, user_id, kind, title, file_path, created_at, updated_at, opened_at)
       VALUES ('art-known', ?, 'whiteboard', 'Mine', '/mine/art-known.excalidraw', '2026-11-20 00:00:00', '2026-11-20 00:00:00', '2026-11-20 00:00:00')`,
    ).run(userId);
    const directory = path.join('/home/u', 'Artefacts');
    const result = backupDb.mergeSnapshot(SNAPSHOT, {
      userId,
      projectPaths: new Set(['/p/one']),
      restoredSessions: new Map([['prov-1', '/h/prov-1.jsonl']]),
      now: new Date('2026-11-14T08:00:00Z'),
      artefacts: { directory, records: SNAPSHOT.artefacts },
    });
    assert.equal(result.artefacts, 2);
    const rows = db.prepare(
      `SELECT id, user_id, kind, title, file_path, session_id, pinned, created_at, opened_at FROM artefacts ORDER BY id`,
    ).all() as Array<Record<string, unknown>>;
    assert.deepEqual(rows.map((row) => [row.id, row.user_id, row.kind, row.title, row.file_path, row.session_id, row.pinned]), [
      ['art-1', userId, 'sheet', 'Budget', path.join(directory, 'art-1.json'), 'app-1', 1],
      // app-2's chat was not restored, so the artefact stands on its own.
      ['art-2', userId, 'doc', 'Notes', path.join(directory, 'art-2.md'), null, 0],
      ['art-known', userId, 'whiteboard', 'Mine', '/mine/art-known.excalidraw', null, 0],
    ]);
    assert.equal(rows[0].created_at, '2026-11-01 10:00:00');
    assert.equal(rows[0].opened_at, '2026-11-03 10:00:00');
    assert.ok(typeof rows[1].created_at === 'string' && rows[1].created_at.length > 0);

    const exported = backupDb.exportSnapshot(userId).artefacts
      .map((row) => [row.id, row.fileName, row.sessionId, row.pinned])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    assert.deepEqual(exported, [
      ['art-1', 'art-1.json', 'app-1', true],
      ['art-2', 'art-2.md', null, false],
      ['art-known', 'art-known.excalidraw', null, false],
    ]);
    assert.deepEqual(backupDb.findKnownArtefactIds(['art-1', 'art-9', 'art-known']), new Set(['art-1', 'art-known']));
  });
});
