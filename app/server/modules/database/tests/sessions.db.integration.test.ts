import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('session archive queries hide archived rows from active project views', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-active', 'claude', '/workspace/demo-project', 'Active Session');
    sessionsDb.createSession('session-archived', 'claude', '/workspace/demo-project', 'Archived Session');
    sessionsDb.updateSessionIsArchived('session-archived', true);

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const activeProjectSessions = sessionsDb.getSessionsByProjectPath('/workspace/demo-project');
    const allProjectSessions = sessionsDb.getSessionsByProjectPathIncludingArchived('/workspace/demo-project');

    assert.deepEqual(activeSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(archivedSessions.map((session) => session.session_id), ['session-archived']);
    assert.deepEqual(activeProjectSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(
      allProjectSessions.map((session) => session.session_id).sort(),
      ['session-active', 'session-archived'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath('/workspace/demo-project'), 1);
  });
});

test('transcript indexing does not restore an archived project or any of its conversations', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('old-session', 'claude', '/workspace/hidden', 'Old');
    projectsDb.updateProjectIsArchived('/workspace/hidden', true);
    sessionsDb.createSession('old-session', 'claude', '/workspace/hidden', 'Updated', undefined, '2026-11-16T01:00:00Z');
    sessionsDb.createSession('new-session', 'claude', '/workspace/hidden', 'New background session');
    assert.equal(projectsDb.getProjectPath('/workspace/hidden')?.isArchived, 1);
    assert.equal(sessionsDb.getRecentSessionsPage(20, 0).sessions.length, 0);
  });
});

test('createSession keeps an archived row archived, and only a restore brings it back', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'First Name');
    sessionsDb.updateSessionIsArchived('session-reused', true);

    // The transcript is written to again: the row is updated but stays in the archive.
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'Updated Name');

    assert.equal(sessionsDb.getAllSessions().length, 0);
    assert.equal(sessionsDb.getArchivedSessions()[0]?.custom_name, 'Updated Name');
    assert.equal(sessionsDb.getSessionById('session-reused')?.isArchived, 1);

    sessionsDb.updateSessionIsArchived('session-reused', false);
    assert.equal(sessionsDb.getAllSessions()[0]?.session_id, 'session-reused');
  });
});

test("createSession leaves an archived row archived when the transcript has not changed", async () => {
  await withIsolatedDatabase(() => {
    const createdAt = "2026-07-18T09:00:00.000Z";
    const updatedAt = "2026-07-18T10:00:00.000Z";
    const jsonlPath = "/transcripts/session-untouched.jsonl";

    sessionsDb.createSession("session-untouched", "claude", "/workspace/demo-project", "A Name", createdAt, updatedAt, jsonlPath);
    sessionsDb.updateSessionIsArchived("session-untouched", true);

    // A full rescan re-indexes every transcript created since the last scan,
    // changed or not, and hands over the timestamps the file still carries.
    sessionsDb.createSession("session-untouched", "claude", "/workspace/demo-project", "A Name", createdAt, updatedAt, jsonlPath);

    assert.equal(sessionsDb.getSessionById("session-untouched")?.isArchived, 1);
    assert.equal(sessionsDb.getArchivedSessions().length, 1);
    assert.equal(sessionsDb.getAllSessions().length, 0);

    // Newer activity (a turn finishing after the archive) does not bring it back either.
    sessionsDb.createSession("session-untouched", "claude", "/workspace/demo-project", "A Name", createdAt, "2026-07-18T11:00:00.000Z", jsonlPath);

    assert.equal(sessionsDb.getSessionById("session-untouched")?.isArchived, 1);
  });
});

test("the upsert path keeps an archived row archived, with or without a timestamp", async () => {
  await withIsolatedDatabase(() => {
    // An app-created row carries no provider id, so indexing it takes the
    // INSERT ... ON CONFLICT branch rather than the UPDATE above.
    sessionsDb.createAppSession("session-legacy", "claude", "/workspace/demo-project");
    sessionsDb.updateSessionIsArchived("session-legacy", true);

    sessionsDb.createSession("session-legacy", "claude", "/workspace/demo-project", "Indexed Name");

    assert.equal(sessionsDb.getSessionById("session-legacy")?.isArchived, 1);
  });
});

test("the upsert path leaves an archived row alone for a transcript older than it", async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession("session-stale", "claude", "/workspace/demo-project");
    sessionsDb.updateSessionIsArchived("session-stale", true);

    sessionsDb.createSession("session-stale", "claude", "/workspace/demo-project", "Indexed Name", "2026-07-18T09:00:00.000Z", "2026-07-18T10:00:00.000Z", "/transcripts/session-stale.jsonl");

    assert.equal(sessionsDb.getSessionById("session-stale")?.isArchived, 1);
  });
});


test('repository reads normalize SQLite UTC timestamps to ISO strings', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');

    const row = sessionsDb.getSessionById('session-timezone');
    assert.ok(row?.created_at.endsWith('Z'));
    assert.ok(row?.updated_at.endsWith('Z'));
    assert.match(row?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('recent sessions are globally ordered, paginated, and limited to visible conversations', async () => {
  await withIsolatedDatabase(() => {
    const fixtures: Array<Parameters<typeof sessionsDb.createSession>> = [
      ['session-oldest', 'claude', '/workspace/project-a', 'Oldest', '2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z'],
      ['session-newest', 'codex', '/workspace/project-b', 'Newest', '2026-07-18T11:00:00.000Z', '2026-07-18T12:00:00.900Z'],
      ['session-same-second', 'claude', '/workspace/project-a', 'Same second, slightly older', '2026-07-18T12:00:00.000Z', '2026-07-18T12:00:00.100Z'],
      ['session-middle', 'claude', '/workspace/project-a', 'Middle', '2026-07-18T10:00:00.000Z', '2026-07-18T11:00:00.000Z'],
      ['session-archived', 'claude', '/workspace/project-a', 'Archived session', '2026-07-18T13:00:00.000Z', '2026-07-18T13:00:00.000Z'],
      ['session-hidden-project', 'claude', '/workspace/project-hidden', 'Archived project session', '2026-07-18T14:00:00.000Z', '2026-07-18T14:00:00.000Z'],
    ];
    fixtures.forEach((fixture) => sessionsDb.createSession(...fixture));

    sessionsDb.updateSessionIsArchived('session-archived', true);
    projectsDb.updateProjectIsArchived('/workspace/project-hidden', true);

    const firstPage = sessionsDb.getRecentSessionsPage(2, 0);
    const secondPage = sessionsDb.getRecentSessionsPage(2, 2);

    assert.equal(firstPage.total, 4);
    assert.deepEqual(
      firstPage.sessions.map((session) => session.session_id),
      ['session-newest', 'session-same-second'],
    );
    assert.equal(secondPage.total, 4);
    assert.deepEqual(
      secondPage.sessions.map((session) => session.session_id),
      ['session-middle', 'session-oldest'],
    );
  });
});

test('inactive sessions are listed for the archiver, oldest first, without archived or scheduled ones', async () => {
  await withIsolatedDatabase(() => {
    const day = 24 * 60 * 60 * 1000;
    const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
    const recent = sessionsDb.createSession('recent', 'claude', '/workspace/demo', 'Recent', ago(0.5), ago(0.5));
    const old = sessionsDb.createSession('old', 'claude', '/workspace/demo', 'Old', ago(10), ago(10));
    const older = sessionsDb.createSession('older', 'claude', '/workspace/demo', 'Older', ago(20), ago(20));
    const archived = sessionsDb.createSession('archived', 'claude', '/workspace/demo', 'Archived', ago(30), ago(30));
    sessionsDb.updateSessionIsArchived(archived, true);
    const scheduled = sessionsDb.createSession('scheduled', 'claude', '/workspace/demo', 'Scheduled', ago(40), ago(40));
    // The fixture message needs no real user row.
    getConnection().pragma('foreign_keys = OFF');
    getConnection().prepare(
      `INSERT INTO scheduled_messages (id, user_id, session_id, content, scheduled_for, status) VALUES ('m1', 1, ?, 'later', ?, 'pending')`,
    ).run(scheduled, new Date(Date.now() + day).toISOString());
    getConnection().pragma('foreign_keys = ON');

    assert.deepEqual(sessionsDb.listInactiveUnarchivedSessions(7).map((row) => row.session_id), [older, old]);
    assert.deepEqual(sessionsDb.listInactiveUnarchivedSessions(14).map((row) => row.session_id), [older]);
    assert.equal(sessionsDb.listInactiveUnarchivedSessions(1).some((row) => row.session_id === recent), false);
  });
});
