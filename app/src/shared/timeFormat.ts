// Locale-aware time strings shared by the transcript's message times and the
// quota views. Everything is shown in the browser's own time zone, which the
// exact form names, so a reading is never ambiguous across devices.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const toDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value));

/** The browser time zone's short name for this moment, such as "GMT+8" or "PST". */
function timeZoneLabel(date: Date, locale: string): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' })
      .formatToParts(date)
      .find((item) => item.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

/** Year, month, day and minute in the locale's order, followed by the time zone: "2026/11/15 23:34 (GMT+8)". */
export function formatExactTime(value: Date | string | number, locale: string): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const text = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
  const zone = timeZoneLabel(date, locale);
  return zone ? `${text} (${zone})` : text;
}

/**
 * How long ago, in whole units: null under a minute (the caller says "just
 * now"), then minutes, hours and days, rounded down. Older than a week falls
 * back to the date.
 */
export function formatRelativeTime(value: Date | string | number, now: number, locale: string): string | null {
  const date = toDate(value);
  const elapsed = now - date.getTime();
  if (Number.isNaN(elapsed)) return '';
  if (elapsed < MINUTE) return null;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), 'day');
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, { year: sameYear ? undefined : 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/**
 * When a quota window resets, as briefly as is unambiguous: the time for today,
 * the weekday and time within the week, the date and time beyond it.
 */
export function formatResetTime(value: Date | string | number, now: number, locale: string): { text: string; today: boolean } {
  const date = toDate(value);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  const current = new Date(now);
  if (date.toDateString() === current.toDateString()) return { text: time, today: true };
  if (date.getTime() - now < 6 * DAY) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
    return { text: `${weekday} ${time}`, today: false };
  }
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
  return { text: `${day} ${time}`, today: false };
}
