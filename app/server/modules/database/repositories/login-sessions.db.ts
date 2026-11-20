/**
 * Login sessions repository: one row per signed-in device. See
 * LOGIN_SESSIONS_TABLE_SCHEMA_SQL for the meaning of each column.
 */

import { getConnection } from '@/modules/database/connection.js';

type LoginSessionRow = {
  id: string;
  user_id: number;
  password_generation: string;
  via: string;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number;
};

type NewLoginSession = Omit<LoginSessionRow, 'last_seen_at'>;

export const loginSessionsDb = {
  /** Stores a new signed-in device. */
  create(session: NewLoginSession): void {
    getConnection().prepare(
      `INSERT INTO login_sessions (id, user_id, password_generation, via, ip, user_agent, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      session.id, session.user_id, session.password_generation, session.via,
      session.ip, session.user_agent, session.created_at, session.created_at,
    );
  },

  /** Returns the session a token names, or undefined once it was signed out. */
  get(sessionId: string): LoginSessionRow | undefined {
    return getConnection()
      .prepare('SELECT * FROM login_sessions WHERE id = ?')
      .get(sessionId) as LoginSessionRow | undefined;
  },

  /** Records that the device was seen at `at`. */
  touch(sessionId: string, at: number): void {
    getConnection().prepare('UPDATE login_sessions SET last_seen_at = ? WHERE id = ?').run(at, sessionId);
  },

  /** Signs one device out. */
  delete(sessionId: string): void {
    getConnection().prepare('DELETE FROM login_sessions WHERE id = ?').run(sessionId);
  },

  /**
   * Drops sessions that can no longer be used: those of an earlier password
   * and those not seen since `seenBefore`.
   */
  deleteStale(currentGeneration: string, seenBefore: number): void {
    getConnection().prepare(
      'DELETE FROM login_sessions WHERE password_generation <> ? OR last_seen_at < ?',
    ).run(currentGeneration, seenBefore);
  },
};
