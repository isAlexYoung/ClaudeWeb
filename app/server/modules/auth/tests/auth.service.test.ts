import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createAuthService } from '../auth.service.js';
import { createLoginLockout } from '../login-lockout.service.js';

type User = { id: number; username: string };
type SessionRow = {
  id: string; user_id: number; password_generation: string; via: string;
  ip: string | null; user_agent: string | null; created_at: number; last_seen_at: number;
};

function createHarness(options: { password?: string | null; generation?: string } = {}) {
  let now = 1_000_000;
  let generation: string | null = options.password === null ? null : (options.generation ?? 'gen-1');
  const password = options.password ?? 'right-password';
  const sessions = new Map<string, SessionRow>();
  const attempts = new Map<string, { failures: number; lockedUntil: number; updatedAt: number }>();
  const owner: User = { id: 1, username: 'claudeweb' };
  let verifyCalls = 0;
  let nextSession = 0;

  const service = createAuthService<User>({
    owner: {
      ensure: () => owner,
      getById: (userId) => (userId === owner.id ? owner : undefined),
      recordLogin: () => undefined,
    },
    sessions: {
      create: (session) => { sessions.set(session.id, { ...session, last_seen_at: session.created_at }); },
      get: (sessionId) => sessions.get(sessionId),
      touch: (sessionId, at) => { const row = sessions.get(sessionId); if (row) row.last_seen_at = at; },
      delete: (sessionId) => { sessions.delete(sessionId); },
      deleteStale: (current, seenBefore) => {
        for (const [id, row] of sessions) {
          if (row.password_generation !== current || row.last_seen_at < seenBefore) sessions.delete(id);
        }
      },
    },
    password: {
      verify: async (candidate) => {
        verifyCalls += 1;
        return generation === null ? null : { matches: candidate === password, generation };
      },
      currentGeneration: () => generation,
    },
    lockout: createLoginLockout({
      store: {
        get: (ip) => attempts.get(ip),
        set: (ip, record) => { attempts.set(ip, record); },
        delete: (ip) => { attempts.delete(ip); },
      },
      now: () => now,
    }),
    signToken: (claims) => `token:${claims.sid}`,
    createSessionId: () => `session-${(nextSession += 1)}`,
    now: () => now,
  });

  return {
    service,
    sessions,
    advance: (milliseconds: number) => { now += milliseconds; },
    setGeneration: (value: string | null) => { generation = value; },
    verifyCalls: () => verifyCalls,
  };
}

const login = (harness: ReturnType<typeof createHarness>, password: string, ip = '203.0.113.5') =>
  harness.service.login({ password, ip, userAgent: 'test' });

const rejectsWith = (code: string, check?: (error: AppError) => void) => (error: unknown) => {
  assert.ok(error instanceof AppError, String(error));
  assert.equal(error.code, code);
  check?.(error);
  return true;
};

test('the right password signs in as the owner and records a session for this device', async () => {
  const harness = createHarness();

  const result = await login(harness, 'right-password');

  assert.equal(result.token, 'token:session-1');
  assert.deepEqual(result.user, { id: 1, username: 'claudeweb' });
  assert.equal(harness.sessions.get('session-1')?.ip, '203.0.113.5');
  assert.equal(harness.sessions.get('session-1')?.password_generation, 'gen-1');
});

test('a wrong password is refused and says how many tries are left', async () => {
  const harness = createHarness();

  await assert.rejects(login(harness, 'nope'), rejectsWith('AUTH_INVALID_PASSWORD', (error) => {
    assert.equal(error.statusCode, 401);
    assert.deepEqual(error.details, { attemptsBeforeLock: 4 });
  }));
  assert.equal(harness.sessions.size, 0);
});

test('five failures lock that IP for a minute without checking passwords; other IPs are unaffected', async () => {
  const harness = createHarness();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(login(harness, 'nope'), rejectsWith('AUTH_INVALID_PASSWORD'));
  }
  await assert.rejects(login(harness, 'nope'), rejectsWith('AUTH_LOCKED', (error) => {
    assert.equal(error.statusCode, 429);
    assert.deepEqual(error.details, { retryAfterSeconds: 60 });
  }));

  const checked = harness.verifyCalls();
  harness.advance(30_000);
  await assert.rejects(login(harness, 'right-password'), rejectsWith('AUTH_LOCKED', (error) => {
    assert.deepEqual(error.details, { retryAfterSeconds: 30 });
  }));
  assert.equal(harness.verifyCalls(), checked, 'a locked IP never reaches the password check');

  assert.equal((await login(harness, 'right-password', '198.51.100.7')).success, true);
});

test('a success clears the count, and when no password is set login says so', async () => {
  const harness = createHarness();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(login(harness, 'nope'), rejectsWith('AUTH_INVALID_PASSWORD'));
  }
  await login(harness, 'right-password');
  await assert.rejects(login(harness, 'nope'), rejectsWith('AUTH_INVALID_PASSWORD', (error) => {
    assert.deepEqual(error.details, { attemptsBeforeLock: 4 });
  }));

  const unset = createHarness({ password: null });
  await assert.rejects(login(unset, 'anything'), rejectsWith('AUTH_PASSWORD_NOT_SET', (error) => {
    assert.equal(error.statusCode, 503);
  }));
  assert.deepEqual(unset.service.getStatus(), { passwordConfigured: false, isAuthenticated: false });
  await assert.rejects(login(harness, ''), rejectsWith('AUTH_PASSWORD_REQUIRED'));
});

test('logout ends only this device; a new password ends every device', async () => {
  const harness = createHarness();
  await login(harness, 'right-password');
  await login(harness, 'right-password');

  assert.deepEqual(harness.service.authenticateSession({ userId: 1, sid: 'session-1' }), { id: 1, username: 'claudeweb' });
  harness.service.logout('session-1');
  assert.equal(harness.service.authenticateSession({ userId: 1, sid: 'session-1' }), null);
  assert.ok(harness.service.authenticateSession({ userId: 1, sid: 'session-2' }));

  harness.setGeneration('gen-2');
  assert.equal(harness.service.authenticateSession({ userId: 1, sid: 'session-2' }), null);
  assert.equal(harness.sessions.has('session-2'), false, 'the old session is removed, not just refused');
});

test('a session is touched at most once a minute', async () => {
  const harness = createHarness();
  await login(harness, 'right-password');
  const seen = () => harness.sessions.get('session-1')?.last_seen_at;
  const first = seen();

  harness.advance(30_000);
  harness.service.authenticateSession({ userId: 1, sid: 'session-1' });
  assert.equal(seen(), first);

  harness.advance(31_000);
  harness.service.authenticateSession({ userId: 1, sid: 'session-1' });
  assert.equal(seen(), (first ?? 0) + 61_000);
});
