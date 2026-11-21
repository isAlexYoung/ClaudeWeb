import { createHash } from 'node:crypto';

import { AppError } from '@/shared/utils.js';

import type { createLoginLockout } from './login-lockout.service.js';

type AuthUser = {
  id: number;
  username: string;
};

type LoginSessionRecord = {
  id: string;
  user_id: number;
  password_generation: string;
  via: string;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number;
  last_active_at: number;
};

type AuthDependencies<User extends AuthUser> = {
  owner: {
    /** The one account every login signs in as; created on first login. */
    ensure(): User;
    getById(userId: number): User | undefined;
    recordLogin(userId: number): void;
  };
  sessions: {
    create(session: Omit<LoginSessionRecord, 'last_seen_at' | 'last_active_at'>): void;
    get(sessionId: string): LoginSessionRecord | undefined;
    list(): LoginSessionRecord[];
    touch(sessionId: string, at: number): void;
    markActive(sessionId: string, at: number): void;
    delete(sessionId: string): void;
    deleteStale(currentGeneration: string, seenBefore: number): void;
  };
  password: {
    /** Null when no password is set on this server. */
    verify(password: string): Promise<{ matches: boolean; generation: string } | null>;
    currentGeneration(): string | null;
  };
  lockout: ReturnType<typeof createLoginLockout>;
  signToken(claims: { userId: number; username: string; sid: string }): string;
  createSessionId(): string;
  now(): number;
};

/** How many devices may be signed in at once. */
const MAX_DEVICES = 3;
// last_seen_at is written at most once a minute, not on every request.
const SESSION_TOUCH_INTERVAL_MS = 60_000;
const ACTIVITY_INTERVAL_MS = 30_000;
// Tokens live 7 days; a session unseen for longer can no longer be used.
const SESSION_UNUSED_LIMIT_MS = 8 * 24 * 60 * 60_000;
// A device signed in by hand in a browser ends after an hour without real use
// (input, or a chat that is working). Background polling does not count.
const WEB_IDLE_LIMIT_MS = 60 * 60_000;

/** The device list never shows session ids, only this stand-in for one. */
function sessionRef(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

/** A short name for the device a browser runs on, from its User-Agent. */
function describeDevice(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const system = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
    : /Windows/.test(ua) ? 'Windows PC'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux PC'
    : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  return [system, browser].filter(Boolean).join(' · ');
}

function lockedError(seconds: number): AppError {
  return new AppError(`Too many failed attempts. Try again in ${seconds} seconds.`, {
    code: 'AUTH_LOCKED',
    statusCode: 429,
    details: { retryAfterSeconds: seconds },
  });
}

/**
 * Creates the Auth application service: one login password set by root, a
 * per-IP lockout, and server-side sessions (signed-in devices) so logout ends
 * one device, a new password ends them all, and at most three are signed in.
 */
export function createAuthService<User extends AuthUser>(dependencies: AuthDependencies<User>) {
  const idle = (session: LoginSessionRecord, now: number) =>
    session.via === 'web' && now - session.last_active_at > WEB_IDLE_LIMIT_MS;

  /** Sessions that still count as signed in, oldest first; ended ones are removed. */
  function liveSessions(generation: string): LoginSessionRecord[] {
    const now = dependencies.now();
    const live: LoginSessionRecord[] = [];
    for (const session of dependencies.sessions.list()) {
      if (session.password_generation !== generation || idle(session, now)
        || now - session.last_seen_at > SESSION_UNUSED_LIMIT_MS) {
        dependencies.sessions.delete(session.id);
      } else {
        live.push(session);
      }
    }
    return live.sort((a, b) => a.created_at - b.created_at);
  }

  function describe(sessions: LoginSessionRecord[], currentId: string | null) {
    return {
      max: MAX_DEVICES,
      logins: sessions.map((session, index) => ({
        ref: sessionRef(session.id),
        device: describeDevice(session.user_agent),
        via: session.via === 'cmcp' ? 'cmcp' : 'claudeweb',
        ip: session.ip ?? '',
        at: session.created_at,
        // The oldest login is the main device: it alone may update ClaudeWeb.
        main: index === 0,
        current: session.id === currentId,
      })),
    };
  }

  /** The session behind a token, or null when it no longer counts as signed in. */
  function checkSession(sessionId: string, userId?: number): LoginSessionRecord | null {
    const generation = dependencies.password.currentGeneration();
    const session = dependencies.sessions.get(sessionId);
    if (!session) return null;
    if (!generation || session.password_generation !== generation
      || (userId !== undefined && session.user_id !== userId) || idle(session, dependencies.now())) {
      dependencies.sessions.delete(session.id);
      return null;
    }
    return session;
  }

  return {
    getStatus() {
      return {
        passwordConfigured: dependencies.password.currentGeneration() !== null,
        isAuthenticated: false,
      };
    },

    /**
     * Checks the password and signs this device in. When other devices are
     * signed in, the caller first gets AUTH_CHOICE_REQUIRED with their list and
     * must say `join` (keep them; when three are in, `replace` names the one to
     * sign out) or `takeover` (sign all of them out).
     */
    async login(input: { password: unknown; ip: string; userAgent: string | null; mode?: unknown; replace?: unknown; via?: 'web' | 'cmcp' }) {
      const password = typeof input.password === 'string' ? input.password : '';
      if (!password) {
        throw new AppError('Enter the password', { code: 'AUTH_PASSWORD_REQUIRED', statusCode: 400 });
      }
      const mode = input.mode === 'join' || input.mode === 'takeover' ? input.mode : null;

      const secondsLocked = dependencies.lockout.secondsLocked(input.ip);
      if (secondsLocked > 0) throw lockedError(secondsLocked);

      const result = await dependencies.password.verify(password);
      if (!result) {
        throw new AppError('No login password is set on this server. As root, run: claudeweb password --set', {
          code: 'AUTH_PASSWORD_NOT_SET',
          statusCode: 503,
        });
      }
      if (!result.matches) {
        const failure = dependencies.lockout.recordFailure(input.ip);
        if (failure.lockedForSeconds > 0) throw lockedError(failure.lockedForSeconds);
        throw new AppError('Wrong password', {
          code: 'AUTH_INVALID_PASSWORD',
          statusCode: 401,
          details: { attemptsBeforeLock: failure.attemptsBeforeLock },
        });
      }
      dependencies.lockout.recordSuccess(input.ip);

      const now = dependencies.now();
      dependencies.sessions.deleteStale(result.generation, now - SESSION_UNUSED_LIMIT_MS);
      const others = liveSessions(result.generation);
      if (others.length > 0) {
        if (!mode) {
          throw new AppError('Another device is signed in', {
            code: 'AUTH_CHOICE_REQUIRED', statusCode: 409, details: describe(others, null),
          });
        }
        if (mode === 'takeover') {
          for (const session of others) dependencies.sessions.delete(session.id);
        } else if (others.length >= MAX_DEVICES) {
          const replaced = others.find((session) => sessionRef(session.id) === input.replace);
          if (!replaced) {
            throw new AppError(`At most ${MAX_DEVICES} devices can be signed in. Choose one to sign out.`, {
              code: 'AUTH_DEVICE_LIMIT', statusCode: 409, details: describe(others, null),
            });
          }
          dependencies.sessions.delete(replaced.id);
        }
      }

      const user = dependencies.owner.ensure();
      const sessionId = dependencies.createSessionId();
      dependencies.sessions.create({
        id: sessionId,
        user_id: user.id,
        password_generation: result.generation,
        via: input.via ?? 'web',
        ip: input.ip,
        user_agent: input.userAgent,
        created_at: now,
      });
      dependencies.owner.recordLogin(user.id);

      return {
        success: true,
        user: { id: user.id, username: user.username },
        token: dependencies.signToken({ userId: user.id, username: user.username, sid: sessionId }),
      };
    },

    /**
     * Resolves the user behind a token's session, or null when the device was
     * signed out, went idle, the password changed, or no password is set.
     * Requests do not count as use; only `recordActivity` does.
     */
    authenticateSession(claims: { userId: number; sid: string }): User | null {
      const session = checkSession(claims.sid, claims.userId);
      if (!session) return null;
      const user = dependencies.owner.getById(session.user_id);
      if (!user) return null;
      const now = dependencies.now();
      if (now - session.last_seen_at >= SESSION_TOUCH_INTERVAL_MS) {
        dependencies.sessions.touch(session.id, now);
      }
      return user;
    },

    /** Whether a session still counts as signed in; used to close its open connections. */
    sessionAlive(sessionId: string): boolean {
      return checkSession(sessionId) !== null;
    },

    /** Real use of the page (input, or a working chat): keeps a browser login from going idle. */
    recordActivity(sessionId: string) {
      const session = checkSession(sessionId);
      if (!session) {
        throw new AppError('Session expired. Please log in again.', { code: 'AUTH_TOKEN_EXPIRED', statusCode: 401 });
      }
      const now = dependencies.now();
      if (now - session.last_active_at >= ACTIVITY_INTERVAL_MS) dependencies.sessions.markActive(session.id, now);
      return { success: true };
    },

    /** Everyone signed in, oldest first, with the main device and this one marked. */
    listDevices(sessionId: string) {
      const generation = dependencies.password.currentGeneration();
      return describe(generation ? liveSessions(generation) : [], sessionId);
    },

    /** Signs another device out. This device signs itself out with `logout`. */
    endDevice(sessionId: string, ref: unknown) {
      const generation = dependencies.password.currentGeneration();
      const target = generation ? liveSessions(generation).find((session) => sessionRef(session.id) === ref) : undefined;
      if (!target || target.id === sessionId) {
        throw new AppError('That device is not signed in.', { code: 'AUTH_DEVICE_NOT_FOUND', statusCode: 404 });
      }
      dependencies.sessions.delete(target.id);
      return { success: true };
    },

    /** Whether this device is the main one (the oldest signed-in device). */
    isMainDevice(sessionId: string): boolean {
      const generation = dependencies.password.currentGeneration();
      return Boolean(generation) && liveSessions(generation as string)[0]?.id === sessionId;
    },

    /** A fresh token for the same session. */
    refreshToken(user: AuthUser, sessionId: string) {
      return { token: dependencies.signToken({ userId: user.id, username: user.username, sid: sessionId }) };
    },

    /** Signs this device out; other devices stay signed in. */
    logout(sessionId: string) {
      dependencies.sessions.delete(sessionId);
      return { success: true };
    },
  };
}
