import assert from 'node:assert/strict';
import test from 'node:test';

import { createLoginLockout } from '../login-lockout.service.js';

function createHarness() {
  let now = 0;
  const records = new Map<string, { failures: number; lockedUntil: number; updatedAt: number }>();
  const lockout = createLoginLockout({
    store: {
      get: (ip) => records.get(ip),
      set: (ip, record) => { records.set(ip, record); },
      delete: (ip) => { records.delete(ip); },
    },
    now: () => now,
  });
  return { lockout, advance: (milliseconds: number) => { now += milliseconds; } };
}

function failFiveTimes(harness: ReturnType<typeof createHarness>, ip: string): number {
  let locked = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    locked = harness.lockout.recordFailure(ip).lockedForSeconds;
  }
  return locked;
}

test('every fifth failure locks: 1 minute, then 5 minutes, then 30 minutes each time', () => {
  const harness = createHarness();
  const durations: number[] = [];
  for (let round = 0; round < 4; round += 1) {
    const locked = failFiveTimes(harness, '203.0.113.5');
    durations.push(locked);
    assert.equal(harness.lockout.secondsLocked('203.0.113.5'), locked);
    harness.advance(locked * 1000);
    assert.equal(harness.lockout.secondsLocked('203.0.113.5'), 0);
  }
  assert.deepEqual(durations, [60, 300, 1800, 1800]);
});

test('tries left count down to the next lock', () => {
  const harness = createHarness();
  const left = [1, 2, 3, 4].map(() => harness.lockout.recordFailure('ip').attemptsBeforeLock);
  assert.deepEqual(left, [4, 3, 2, 1]);
});

test('a success, or a day without failures, starts the count again', () => {
  const harness = createHarness();
  harness.lockout.recordFailure('a');
  harness.lockout.recordSuccess('a');
  assert.equal(harness.lockout.recordFailure('a').attemptsBeforeLock, 4);

  failFiveTimes(harness, 'b');
  harness.advance(24 * 60 * 60_000);
  assert.equal(harness.lockout.secondsLocked('b'), 0);
  assert.equal(harness.lockout.recordFailure('b').attemptsBeforeLock, 4, 'the earlier lock no longer counts');
});
