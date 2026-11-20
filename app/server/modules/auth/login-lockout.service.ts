// Failed passwords are counted per source IP. Every 5th failure in a row locks
// that IP: the 1st time for 1 minute, the 2nd for 5 minutes, then 30 minutes
// each time. A successful login clears the count; so do 24 hours without a
// failure. Attempts during a lockout are refused without checking the password
// and are not counted.
const FAILURES_PER_LOCK = 5;
const LOCK_DURATIONS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const QUIET_RESET_MS = 24 * 60 * 60_000;

type AttemptRecord = {
  failures: number;
  lockedUntil: number;
  updatedAt: number;
};

type LockoutDependencies = {
  store: {
    get(ip: string): AttemptRecord | undefined;
    set(ip: string, record: AttemptRecord): void;
    delete(ip: string): void;
  };
  now(): number;
};

/**
 * Creates the per-IP lockout used by the Auth service around password and
 * (later) CMCP logins. `check` before verifying, then `recordFailure` or
 * `recordSuccess` with the outcome.
 */
export function createLoginLockout(dependencies: LockoutDependencies) {
  const current = (ip: string): AttemptRecord | undefined => {
    const record = dependencies.store.get(ip);
    if (!record) return undefined;
    const now = dependencies.now();
    if (record.lockedUntil <= now && now - record.updatedAt >= QUIET_RESET_MS) {
      dependencies.store.delete(ip);
      return undefined;
    }
    return record;
  };

  return {
    /** Seconds left on the IP's lockout, or 0 when it may try a password. */
    secondsLocked(ip: string): number {
      const record = current(ip);
      const remaining = (record?.lockedUntil ?? 0) - dependencies.now();
      return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
    },

    /**
     * Counts a wrong password. Returns the seconds of the lockout it started
     * (0 if none) and how many tries are left before the next one.
     */
    recordFailure(ip: string): { lockedForSeconds: number; attemptsBeforeLock: number } {
      const now = dependencies.now();
      const failures = (current(ip)?.failures ?? 0) + 1;
      const lockIndex = failures % FAILURES_PER_LOCK === 0 ? failures / FAILURES_PER_LOCK - 1 : -1;
      const lockMs = lockIndex >= 0 ? LOCK_DURATIONS_MS[Math.min(lockIndex, LOCK_DURATIONS_MS.length - 1)] : 0;
      dependencies.store.set(ip, { failures, lockedUntil: lockMs ? now + lockMs : 0, updatedAt: now });
      return {
        lockedForSeconds: lockMs / 1000,
        attemptsBeforeLock: lockMs ? FAILURES_PER_LOCK : FAILURES_PER_LOCK - (failures % FAILURES_PER_LOCK),
      };
    },

    /** Clears the IP's count after a correct password. */
    recordSuccess(ip: string): void {
      dependencies.store.delete(ip);
    },
  };
}
