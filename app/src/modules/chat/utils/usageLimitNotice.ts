/**
 * Reads the message Claude Code writes into a conversation when a
 * subscription limit stops a turn, e.g.
 *
 *   You've hit your 5-hour limit · resets 9:20pm (Asia/Singapore)
 *   You've hit your weekly limit · resets Dec 2, 9am (Asia/Singapore)
 *   Opus weekly limit reached ∙ resets Oct 9, 4pm
 *   Claude AI usage limit reached|1763906400          (older CLIs)
 *
 * MessageComponent draws such a message as a card with the time left and an
 * option to continue the task once the limit resets. Only a message that is
 * nothing but the notice is read as one, so a reply that merely talks about
 * limits stays a reply.
 */

export type UsageLimitKind = 'fiveHour' | 'weekly' | 'opusWeekly' | 'sonnetWeekly' | 'opus' | 'generic';

export type UsageLimitNotice = {
  kind: UsageLimitKind;
  /** The limit as the message names it ("5-hour", "weekly"), for kinds without a translation. */
  label: string;
  /** The reset as written, without the time zone ("9:20pm", "Dec 2, 9am"). */
  resetText: string;
  /** The IANA time zone the reset is written in, when the message names one. */
  timeZone: string | null;
  /** When the limit resets, or null when the written time could not be read. */
  resetsAt: Date | null;
};

const LEGACY = /^Claude AI usage limit reached\|(\d{10,13})$/;
// "You've hit your 5-hour limit · resets 9:20pm (Asia/Singapore)"
const HIT_YOUR = /^You(?:'|’|\s+ha)ve\s+hit\s+your\s+(.*?)\s*limits?\s*[·∙•|-]\s*resets\s+(.+?)\s*(?:\(([^()]+)\))?\.?$/i;
// "5-hour limit reached ∙ resets 1am" / "Weekly limit reached · resets Oct 9, 4pm (Europe/Paris)"
const REACHED = /^(.*?)\s*limits?\s+reached\s*[·∙•|-]\s*resets\s+(.+?)\s*(?:\(([^()]+)\))?\.?$/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function kindOf(label: string): UsageLimitKind {
  const text = label.toLowerCase();
  const weekly = /week/.test(text);
  if (/opus/.test(text)) return weekly ? 'opusWeekly' : 'opus';
  if (/sonnet/.test(text)) return 'sonnetWeekly';
  if (weekly) return 'weekly';
  if (/5[\s-]*h(ou)?r|five[\s-]*hour|session/.test(text)) return 'fiveHour';
  return 'generic';
}

function validTimeZone(zone: string | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The wall-clock parts of an instant in a time zone. */
function wallClock(instant: number, timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
  }).formatToParts(new Date(instant));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
    second: Number(read('second')),
    weekday: WEEKDAYS.indexOf(read('weekday').slice(0, 3).toLowerCase()),
  };
}

/** The instant a wall-clock time in a time zone names (the later one across a DST change is fine here). */
function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string | undefined): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = asUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const wall = wallClock(guess, timeZone);
    const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    guess = asUtc - (wallAsUtc - guess);
  }
  return guess;
}

function readClock(text: string): { hour: number; minute: number } | null {
  const match = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(text.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '');
  if (!meridiem && !match[2]) return null; // a bare number is not a time
  if (minute > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12))) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return { hour, minute };
}

/**
 * The first instant at or after `anchor` that the written reset names, read
 * in `timeZone` (the browser's when the message names none).
 */
export function resolveResetTime(resetText: string, timeZone: string | null, anchor: Date): Date | null {
  const zone = timeZone ?? undefined;
  const clock = readClock(resetText.replace(/\s+at\s+/i, ' '));
  if (!clock) return null;
  const anchorMs = anchor.getTime();
  // A message is written a moment after the limit is hit, never after it resets.
  const notBefore = anchorMs - 60_000;
  const today = wallClock(anchorMs, zone);

  const monthDay = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/.exec(resetText);
  const month = monthDay ? MONTHS.indexOf(monthDay[1].slice(0, 3).toLowerCase()) : -1;
  if (monthDay && month >= 0) {
    const day = Number(monthDay[2]);
    for (const year of [today.year, today.year + 1]) {
      const instant = zonedInstant(year, month + 1, day, clock.hour, clock.minute, zone);
      if (instant >= notBefore) return new Date(instant);
    }
    return null;
  }

  const weekdayMatch = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i.exec(resetText);
  const weekday = weekdayMatch ? WEEKDAYS.indexOf(weekdayMatch[1].toLowerCase()) : -1;
  for (let offset = 0; offset <= 7; offset += 1) {
    // Days are stepped at noon UTC of the wall date, so DST cannot skip or repeat one.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset, 12));
    if (weekday >= 0 && date.getUTCDay() !== weekday) continue;
    const instant = zonedInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), clock.hour, clock.minute, zone);
    if (instant >= notBefore) return new Date(instant);
  }
  return null;
}

function toDate(value: string | number | Date | undefined | null): Date {
  const date = value instanceof Date ? value : value === undefined || value === null || value === '' ? new Date() : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** The limit notice a message is, or null when it is anything else. */
export function parseUsageLimitNotice(content: string, timestamp?: string | number | Date | null): UsageLimitNotice | null {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text || text.length > 200 || text.includes('\n')) return null;

  const legacy = LEGACY.exec(text);
  if (legacy) {
    let ms = Number(legacy[1]);
    if (ms < 1e12) ms *= 1000;
    return { kind: 'generic', label: '', resetText: '', timeZone: null, resetsAt: new Date(ms) };
  }

  const match = HIT_YOUR.exec(text) ?? REACHED.exec(text);
  if (!match) return null;
  const label = match[1].trim();
  const resetText = match[2].trim();
  const timeZone = validTimeZone(match[3]?.trim());
  return {
    kind: kindOf(label),
    label,
    resetText,
    timeZone,
    resetsAt: resolveResetTime(resetText, timeZone, toDate(timestamp)),
  };
}

/** The marker a resume-after-reset scheduled message carries in its options, so its card can find it. */
export const USAGE_LIMIT_RESUME_OPTION = 'resumeAfterUsageLimit';

/** When the continue message goes: a minute after the reset, so the new allowance is in place. */
export const USAGE_LIMIT_RESUME_DELAY_MS = 60_000;

/**
 * The scheduled message that continues a task once a limit resets: sent with
 * the composer's run options, and marked with the reset it belongs to.
 */
export function usageLimitResumeSchedule(resetsAt: Date, content: string, runOptions: Record<string, unknown>) {
  return {
    content,
    scheduledFor: new Date(resetsAt.getTime() + USAGE_LIMIT_RESUME_DELAY_MS),
    options: { ...runOptions, [USAGE_LIMIT_RESUME_OPTION]: resetsAt.toISOString() },
  };
}
