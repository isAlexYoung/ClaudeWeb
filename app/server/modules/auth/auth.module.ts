import { randomBytes } from 'node:crypto';

import { loginAttemptsDb, loginSessionsDb, userDb } from '@/modules/database/index.js';
import { getLoginPasswordGeneration, verifyLoginPassword } from '@/modules/login-password/index.js';

import { createAuthenticateToken } from './auth.middleware.js';
import { createAuthRouter } from './auth.routes.js';
import { createAuthService } from './auth.service.js';
import { readSessionToken, signSessionToken } from './auth-token.service.js';
import { createLoginLockout } from './login-lockout.service.js';

const authService = createAuthService({
  owner: {
    ensure: () => userDb.ensureOwnerUser(),
    getById: (userId) => userDb.getUserById(userId),
    recordLogin: (userId) => userDb.updateLastLogin(userId),
  },
  sessions: loginSessionsDb,
  password: {
    verify: (password) => verifyLoginPassword(password),
    currentGeneration: () => getLoginPasswordGeneration(),
  },
  lockout: createLoginLockout({ store: loginAttemptsDb, now: () => Date.now() }),
  signToken: signSessionToken,
  createSessionId: () => randomBytes(32).toString('hex'),
  now: () => Date.now(),
});

/**
 * Checks one token: valid signature, and a session that still exists under
 * the current password. Past half its lifetime, a replacement token for the
 * same session is handed back so an active browser never expires.
 */
function checkToken(token: string) {
  const read = readSessionToken(token);
  if ('error' in read) return read;
  const user = authService.authenticateSession(read.claims);
  if (!user) return { error: 'invalid' as const };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const halfLife = (read.expiresAt - read.issuedAt) / 2;
  const refreshedToken = nowSeconds > read.issuedAt + halfLife
    ? authService.refreshToken(user, read.claims.sid).token
    : null;
  return { user, sessionId: read.claims.sid, refreshedToken };
}

/** Used by the server entrypoint to protect every authenticated HTTP router. */
export const authenticateToken = createAuthenticateToken(checkToken);

/**
 * Used by the server entrypoint's WebSocket setup to admit chat, shell and
 * browser connections with the same token and session rules as HTTP.
 */
export function authenticateWebSocket(token: string | null) {
  if (!token) return null;
  const result = checkToken(token);
  if ('error' in result) return null;
  return { id: result.user.id, userId: result.user.id, username: result.user.username, sessionId: result.sessionId };
}

/** Used by the WebSocket gateway to close the connections of a device that was signed out. */
export function loginSessionAlive(sessionId: string): boolean {
  return authService.sessionAlive(sessionId);
}

/** Used by the update routes: only the main (oldest) signed-in device may start an update. */
export function isMainLoginDevice(sessionId: string): boolean {
  return authService.isMainDevice(sessionId);
}

/** Auth router assembled for the server entrypoint. */
export const authRoutes = createAuthRouter(authService, authenticateToken);
