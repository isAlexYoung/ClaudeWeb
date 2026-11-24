/**
 * Clearing the per-session caches the page keeps in memory.
 *
 * Chat's session store holds every opened conversation's messages for the life
 * of the page so switching back to one is instant. Those belong to the signed-in
 * account, so signing out must drop them; the store registers its reset here and
 * AuthContext calls it, without the auth module importing chat.
 */

type SessionCacheReset = () => void;

const sessionCacheResets = new Set<SessionCacheReset>();

/** Used by chat's session store to be cleared when the account changes. */
export function registerSessionCacheReset(reset: SessionCacheReset): void {
  sessionCacheResets.add(reset);
}

/** Used by AuthContext on sign-out, next to resetChatDrafts. */
export function resetSessionCaches(): void {
  sessionCacheResets.forEach((reset) => reset());
}
