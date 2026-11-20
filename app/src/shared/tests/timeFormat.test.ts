import assert from 'node:assert/strict';

import { test } from 'vitest';

import { formatExactTime, formatRelativeTime, formatResetTime } from '@/shared/timeFormat';

const NOW = new Date(2026, 10, 15, 23, 34, 30).getTime();
const ago = (ms: number) => new Date(NOW - ms);

test('relative times are whole minutes, hours and days, and under a minute is left to "just now"', () => {
  assert.equal(formatRelativeTime(ago(59_000), NOW, 'en'), null);
  assert.equal(formatRelativeTime(ago(-5_000), NOW, 'en'), null, 'a clock a little behind is still "just now"');
  assert.equal(formatRelativeTime(ago(30 * 60_000 + 59_000), NOW, 'en'), '30 minutes ago');
  assert.equal(formatRelativeTime(ago(2 * 3600_000 + 59 * 60_000), NOW, 'en'), '2 hours ago', 'rounded down');
  assert.equal(formatRelativeTime(ago(30 * 60_000), NOW, 'zh-CN'), '30分钟前');
  assert.equal(formatRelativeTime(ago(2 * 3600_000), NOW, 'zh-CN'), '2小时前');
  assert.equal(formatRelativeTime(ago(3 * 86400_000), NOW, 'en'), '3 days ago');
  assert.doesNotMatch(formatRelativeTime(ago(20 * 86400_000), NOW, 'en') || '', /ago/, 'older than a week shows the date');
});

test('the exact time has the date, the minute and the time zone, but no seconds', () => {
  const text = formatExactTime(new Date(2026, 10, 15, 23, 34, 56), 'zh-CN');
  assert.match(text, /^2026\/11\/15 23:34 \(.+\)$/);
  assert.doesNotMatch(text, /:56/);
});

test('a reset today shows the time only; later in the week the weekday too', () => {
  const today = formatResetTime(new Date(2026, 10, 15, 23, 50), NOW, 'en');
  assert.equal(today.today, true);
  assert.match(today.text, /^11:50\sPM$/);
  const later = formatResetTime(new Date(2026, 10, 19, 17, 0), NOW, 'en');
  assert.equal(later.today, false);
  assert.match(later.text, /^Thu 5:00\sPM$/);
});
