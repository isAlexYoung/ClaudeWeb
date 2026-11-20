import { getConnection } from '@/modules/database/connection.js';
import type { SideChat } from '@/shared/types.js';

type StoredSideChat = SideChat & { context: string; cwd: string };
const initialized = new WeakSet<ReturnType<typeof getConnection>>();
function database() {
  const db = getConnection();
  if (!initialized.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS side_chats (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, parent_session_id TEXT NOT NULL,
      created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS side_chats_parent ON side_chats(user_id, parent_session_id, created_at);`);
    // No SDK process survives a server restart; a retained partial answer is still readable.
    db.prepare(`UPDATE side_chats SET payload = json_set(payload, '$.status', 'error', '$.error', 'SIDECAR_RESTARTED')
      WHERE json_extract(payload, '$.status') = 'running'`).run();
    initialized.add(db);
  }
  return db;
}
function decode(row: unknown): StoredSideChat | null {
  return row ? JSON.parse((row as { payload: string }).payload) : null;
}
/** Used by Side Chats only, keeping their history outside main sessions, pins and usage aggregation. */
export const sideChatsDb = {
  list(userId: number, parentSessionId: string): StoredSideChat[] {
    return database().prepare('SELECT payload FROM side_chats WHERE user_id = ? AND parent_session_id = ? ORDER BY created_at, rowid')
      .all(userId, parentSessionId).map(row => decode(row)!);
  },
  get(userId: number, id: string): StoredSideChat | null {
    return decode(database().prepare('SELECT payload FROM side_chats WHERE user_id = ? AND id = ?').get(userId, id));
  },
  insert(userId: number, chat: StoredSideChat) {
    database().prepare('INSERT INTO side_chats (id, user_id, parent_session_id, created_at, payload) VALUES (?, ?, ?, ?, ?)')
      .run(chat.id, userId, chat.parentSessionId, chat.createdAt, JSON.stringify(chat));
  },
  update(userId: number, chat: StoredSideChat) {
    // UPDATE, never UPSERT: late chunks after a deletion cannot resurrect a conversation.
    database().prepare('UPDATE side_chats SET payload = ? WHERE user_id = ? AND id = ?')
      .run(JSON.stringify(chat), userId, chat.id);
  },
  delete(userId: number, id: string) {
    database().prepare('DELETE FROM side_chats WHERE user_id = ? AND id = ?').run(userId, id);
  },
};
