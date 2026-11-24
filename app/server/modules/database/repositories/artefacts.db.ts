import { getConnection } from '@/modules/database/connection.js';

/** The kinds an artefact row can name: the ones that can be created and edited so far. */
export type ArtefactKind = 'sheet' | 'doc' | 'whiteboard';

/** One artefact as stored: the content lives in `file_path`, everything shown about it here. */
export type ArtefactRow = {
  id: string;
  user_id: number;
  kind: ArtefactKind;
  title: string;
  file_path: string;
  session_id: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
  opened_at: string;
};

const COLUMNS = 'id, user_id, kind, title, file_path, session_id, pinned, created_at, updated_at, opened_at';

/** Used by the Artefacts module; every query is scoped to the signed-in user. */
export const artefactsDb = {
  list(userId: number): ArtefactRow[] {
    return getConnection()
      .prepare(`SELECT ${COLUMNS} FROM artefacts WHERE user_id = ? ORDER BY opened_at DESC, rowid DESC`)
      .all(userId) as ArtefactRow[];
  },

  get(userId: number, id: string): ArtefactRow | null {
    return (getConnection()
      .prepare(`SELECT ${COLUMNS} FROM artefacts WHERE user_id = ? AND id = ?`)
      .get(userId, id) as ArtefactRow | undefined) ?? null;
  },

  getBySessionId(sessionId: string): ArtefactRow | null {
    return (getConnection()
      .prepare(`SELECT ${COLUMNS} FROM artefacts WHERE session_id = ? LIMIT 1`)
      .get(sessionId) as ArtefactRow | undefined) ?? null;
  },

  insert(row: Omit<ArtefactRow, 'pinned' | 'session_id'> & { session_id?: string | null }): void {
    getConnection().prepare(
      `INSERT INTO artefacts (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(row.id, row.user_id, row.kind, row.title, row.file_path, row.session_id ?? null, row.created_at, row.updated_at, row.opened_at);
  },

  /** Title and pin are what the page edits; the time it was changed moves with them. */
  update(userId: number, id: string, fields: { title?: string; pinned?: boolean }, now: string): void {
    const db = getConnection();
    if (fields.title !== undefined) {
      db.prepare('UPDATE artefacts SET title = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(fields.title, now, userId, id);
    }
    if (fields.pinned !== undefined) {
      db.prepare('UPDATE artefacts SET pinned = ? WHERE user_id = ? AND id = ?').run(fields.pinned ? 1 : 0, userId, id);
    }
  },

  touchOpened(userId: number, id: string, now: string): void {
    getConnection().prepare('UPDATE artefacts SET opened_at = ? WHERE user_id = ? AND id = ?').run(now, userId, id);
  },

  touchUpdated(userId: number, id: string, now: string): void {
    getConnection().prepare('UPDATE artefacts SET updated_at = ? WHERE user_id = ? AND id = ?').run(now, userId, id);
  },

  setSession(userId: number, id: string, sessionId: string): void {
    getConnection().prepare('UPDATE artefacts SET session_id = ? WHERE user_id = ? AND id = ?').run(sessionId, userId, id);
  },

  delete(userId: number, id: string): void {
    getConnection().prepare('DELETE FROM artefacts WHERE user_id = ? AND id = ?').run(userId, id);
  },
};
