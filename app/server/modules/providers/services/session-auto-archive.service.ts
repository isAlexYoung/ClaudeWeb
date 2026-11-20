import { sessionsDb, userPreferencesDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

/**
 * Settings > Tasks and sessions > Archive inactive sessions.
 *
 * Once an hour, sessions with no new activity for the chosen number of days
 * move to the archive (Settings, where they can be restored or deleted).
 * Running sessions, pinned sessions and sessions with a pending scheduled
 * message are always kept. The choice is the `autoArchiveInactiveDays` user
 * preference: 0 or unset means never.
 */

export const AUTO_ARCHIVE_PREFERENCE_KEY = 'autoArchiveInactiveDays';
/** The choices the settings page offers; anything else stored is ignored. */
export const AUTO_ARCHIVE_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;

const CHECK_INTERVAL_MS = 60 * 60_000;
// The first pass waits a little, so a restart does not archive before the running-sessions registry has filled.
const FIRST_CHECK_DELAY_MS = 2 * 60_000;

/**
 * The number of days to use, or null for never. With several users the most
 * cautious choice wins: any explicit "never" turns it off, otherwise the
 * longest period applies.
 */
export function readAutoArchiveDays(values: unknown[]): number | null {
  const valid = values.filter((value): value is number => value === 0 || (AUTO_ARCHIVE_DAY_OPTIONS as readonly unknown[]).includes(value));
  if (valid.length === 0 || valid.includes(0)) return null;
  return Math.max(...valid);
}

/** Every pinned session id, from each user's `workspaceSessions` preference. */
export function readPinnedSessionIds(values: unknown[]): Set<string> {
  const pinned = new Set<string>();
  for (const value of values) {
    const ids = (value as { pinnedSessionIds?: unknown } | null)?.pinnedSessionIds;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') pinned.add(id);
  }
  return pinned;
}

type ArchiverDependencies = {
  readPreference: (key: string) => unknown[];
  listInactive: (days: number) => Array<{ session_id: string }>;
  listRunningIds: () => Promise<string[]>;
  archive: (sessionId: string) => void;
};

const defaultDependencies: ArchiverDependencies = {
  readPreference: (key) => userPreferencesDb.getValuesForKey(key),
  listInactive: (days) => sessionsDb.listInactiveUnarchivedSessions(days),
  listRunningIds: async () => (await sessionsService.listRunningSessions()).map((entry) => entry.sessionId),
  archive: (sessionId) => sessionsDb.updateSessionIsArchived(sessionId, true),
};

/** One pass; returns the ids it archived. Exported for tests and for a manual run. */
export async function archiveInactiveSessions(dependencies: ArchiverDependencies = defaultDependencies): Promise<string[]> {
  const days = readAutoArchiveDays(dependencies.readPreference(AUTO_ARCHIVE_PREFERENCE_KEY));
  if (days === null) return [];
  const candidates = dependencies.listInactive(days);
  if (candidates.length === 0) return [];
  const keep = readPinnedSessionIds(dependencies.readPreference('workspaceSessions'));
  for (const id of await dependencies.listRunningIds()) keep.add(id);
  const archived: string[] = [];
  for (const { session_id: sessionId } of candidates) {
    if (keep.has(sessionId)) continue;
    dependencies.archive(sessionId);
    archived.push(sessionId);
  }
  return archived;
}

let timer: ReturnType<typeof setInterval> | null = null;
let firstCheck: ReturnType<typeof setTimeout> | null = null;

/** Started by server/index.ts beside the scheduled-task dispatchers. */
export function initializeSessionAutoArchive(): void {
  closeSessionAutoArchive();
  const pass = () => {
    void archiveInactiveSessions().then((archived) => {
      if (archived.length > 0) console.log(`[AutoArchive] Archived ${archived.length} inactive session(s)`);
    }).catch((error: unknown) => {
      console.error('[AutoArchive] Pass failed', { error: error instanceof Error ? error.message : String(error) });
    });
  };
  firstCheck = setTimeout(pass, FIRST_CHECK_DELAY_MS);
  firstCheck.unref?.();
  timer = setInterval(pass, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function closeSessionAutoArchive(): void {
  if (firstCheck) clearTimeout(firstCheck);
  if (timer) clearInterval(timer);
  firstCheck = null;
  timer = null;
}
