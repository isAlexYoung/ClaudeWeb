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
  last_seen_at: number;
};

type AuthDependencies<User extends AuthUser> = {
  owner: {
    /** The one account every login signs in as; created on first login. */
    ensure(): User;
    getById(userId: number): User | undefined;
    recordLogin(userId: number): void;
  };
  sessions: {
    create(session: {
      id: string;
      user_id: number;
      password_generation: string;
      via: string;
      ip: string | null;
      user_agent: string | null;
      created_at: number;
    }): void;
    get(sessionId: string): LoginSessionRecord | undefined;
    touch(sessionId: string, at: number): void;
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

// last_seen_at is written at most once a minute, not on every request.
const SESSION_TOUCH_INTERVAL_MS = 60_000;
// Tokens live 7 days; a session unseen for longer can no longer be used.
const SESSION_UNUSED_LIMIT_MS = 8 * 24 * 60 * 60_000;

function lockedError(seconds: number): AppError {
  return new AppError(`Too many failed attempts. Try again in ${seconds} seconds.`, {
    code: 'AUTH_LOCKED',
    statusCode: 429,
    details: { retryAfterSeconds: seconds },
  });
}

/**
 * Creates the Auth application service: one login password set by root, a
 * per-IP lockout, and server-side sessions so logout ends one device and a
 * new password ends them all.
 */
export function createAuthService<User extends AuthUser>(dependencies: AuthDependencies<User>) {
  return {
    getStatus() {
      return {
        passwordConfigured: dependencies.password.currentGeneration() !== null,
        isAuthenticated: false,
      };
    },

    async login(input: { password: unknown; ip: string; userAgent: string | null }) {
      const password = typeof input.password === 'string' ? input.password : '';
      if (!password) {
        throw new AppError('Enter the password', { code: 'AUTH_PASSWORD_REQUIRED', statusCode: 400 });
      }

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
      const user = dependencies.owner.ensure();
      dependencies.sessions.deleteStale(result.generation, now - SESSION_UNUSED_LIMIT_MS);
      const sessionId = dependencies.createSessionId();
      dependencies.sessions.create({
        id: sessionId,
        user_id: user.id,
        password_generation: result.generation,
        via: 'web',
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
     * signed out, the password changed since, or no password is set any more.
     */
    authenticateSession(claims: { userId: number; sid: string }): User | null {
      const generation = dependencies.password.currentGeneration();
      const session = dependencies.sessions.get(claims.sid);
      if (!session) return null;
      if (!generation || session.password_generation !== generation || session.user_id !== claims.userId) {
        dependencies.sessions.delete(session.id);
        return null;
      }
      const user = dependencies.owner.getById(session.user_id);
      if (!user) return null;
      const now = dependencies.now();
      if (now - session.last_seen_at >= SESSION_TOUCH_INTERVAL_MS) {
        dependencies.sessions.touch(session.id, now);
      }
      return user;
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
