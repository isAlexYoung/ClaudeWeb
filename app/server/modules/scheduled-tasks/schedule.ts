import { AppError } from '@/shared/utils.js';

/**
 * When a scheduled task runs. Times of day are read in the task's time zone,
 * so "every day at 09:00" stays 09:00 for the user across daylight saving.
 *
 * - once:     a single moment (`at`, an ISO instant)
 * - daily:    every day at `time` (HH:MM)
 * - weekly:   on `days` (0 = Sunday ... 6 = Saturday) at `time`
 * - interval: every `hours` hours, counted from the previous run
 */
export type TaskSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; days: number[] }
  | { kind: 'interval'; hours: number };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_INTERVAL_HOURS = 24 * 7;
const MAX_ONCE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

function invalid(message: string): never {
  throw new AppError(message, { code: 'INVALID_SCHEDULE', statusCode: 400 });
}

/** A zone Intl understands, or UTC when it does not know the one given. */
export function normalizeTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** Checks a schedule from the client and returns it in its stored form. */
export function parseSchedule(value: unknown, now: Date = new Date()): TaskSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('A schedule is required.');
  const input = value as Record<string, unknown>;
  switch (input.kind) {
    case 'once': {
      const at = typeof input.at === 'string' ? new Date(input.at) : null;
      if (!at || Number.isNaN(at.getTime())) invalid('Pick a date and time.');
      if (at.getTime() > now.getTime() + MAX_ONCE_AHEAD_MS) invalid('Pick a time within a year.');
      return { kind: 'once', at: at.toISOString() };
    }
    case 'daily': {
      if (typeof input.time !== 'string' || !TIME_PATTERN.test(input.time)) invalid('Pick a time of day.');
      return { kind: 'daily', time: input.time };
    }
    case 'weekly': {
      if (typeof input.time !== 'string' || !TIME_PATTERN.test(input.time)) invalid('Pick a time of day.');
      const days = Array.isArray(input.days)
        ? [...new Set(input.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
          .sort((a, b) => a - b)
        : [];
      if (days.length === 0) invalid('Pick at least one day of the week.');
      return { kind: 'weekly', time: input.time, days };
    }
    case 'interval': {
      const hours = Number(input.hours);
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_INTERVAL_HOURS) {
        invalid(`The interval must be a whole number of hours from 1 to ${MAX_INTERVAL_HOURS}.`);
      }
      return { kind: 'interval', hours };
    }
    default:
      return invalid('Unknown schedule kind.');
  }
}

/** Reads a stored schedule; null when the row holds something unreadable. */
export function readSchedule(raw: string): TaskSchedule | null {
  try {
    return parseSchedule(JSON.parse(raw), new Date(0));
  } catch {
    return null;
  }
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(instant: Date, timeZone: string): LocalParts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute),
  };
}

/** The UTC instant at which the wall clock in `timeZone` shows this date and time. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number) => {
    const local = localParts(new Date(instant), timeZone);
    return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - Math.floor(instant / 60_000) * 60_000;
  };
  // Two passes settle the offset on either side of a daylight-saving change.
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

/**
 * The first time the schedule fires strictly after `after`, or null when it
 * never fires again (a one-off task whose moment has passed).
 *
 * A run that was missed while the server was down is not repeated for every
 * occurrence it missed: the dispatcher runs it once and asks for the next time
 * after now.
 */
export function nextRunAfter(schedule: TaskSchedule, timeZone: string, after: Date): Date | null {
  switch (schedule.kind) {
    case 'once': {
      const at = new Date(schedule.at);
      return at.getTime() > after.getTime() ? at : null;
    }
    case 'interval':
      return new Date(after.getTime() + schedule.hours * 60 * 60 * 1000);
    case 'daily':
    case 'weekly': {
      const [hour, minute] = schedule.time.split(':').map(Number);
      const today = localParts(after, timeZone);
      for (let offset = 0; offset <= 8; offset += 1) {
        const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
        if (schedule.kind === 'weekly' && !schedule.days.includes(date.getUTCDay())) continue;
        const candidate = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone);
        if (candidate.getTime() > after.getTime()) return candidate;
      }
      return null;
    }
  }
}

/** The run's local date and time, used in the title of the conversation it starts. */
export function formatRunTime(instant: Date, timeZone: string): string {
  const local = localParts(instant, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(local.month)}-${pad(local.day)} ${pad(local.hour)}:${pad(local.minute)}`;
}
