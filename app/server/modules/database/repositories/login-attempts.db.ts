/**
 * Login attempts repository: failed password attempts and lockouts per source
 * IP. See LOGIN_ATTEMPTS_TABLE_SCHEMA_SQL.
 */

import { getConnection } from '@/modules/database/connection.js';

type LoginAttemptRow = {
  failures: number;
  lockedUntil: number;
  updatedAt: number;
};

export const loginAttemptsDb = {
  /** Returns the IP's failures since its last success, or undefined if none. */
  get(ip: string): LoginAttemptRow | undefined {
    const row = getConnection()
      .prepare('SELECT failures, locked_until, updated_at FROM login_attempts WHERE ip = ?')
      .get(ip) as { failures: number; locked_until: number; updated_at: number } | undefined;
    return row ? { failures: row.failures, lockedUntil: row.locked_until, updatedAt: row.updated_at } : undefined;
  },

  /** Stores the IP's current count and lockout. */
  set(ip: string, attempt: LoginAttemptRow): void {
    getConnection().prepare(
      `INSERT INTO login_attempts (ip, failures, locked_until, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET failures = excluded.failures,
         locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
    ).run(ip, attempt.failures, attempt.lockedUntil, attempt.updatedAt);
  },

  /** Forgets the IP's failures, after a successful login. */
  delete(ip: string): void {
    getConnection().prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
  },
};
