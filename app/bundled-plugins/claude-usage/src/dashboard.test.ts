import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDashboard } from './dashboard.js';
import type { UsageEntry } from './history.js';

const now = Date.parse('2026-11-15T04:00:00Z');
const entry = (id: string, timestamp: string, input = 10, model = 'claude-opus-4-8'): UsageEntry =>
  ({ id, timestamp, model, tokens: { input, output: 2, cacheRead: 3, cacheCreate: 4 } });

test('all-time includes older than 365 days and reports accurate separate cache/model totals', () => {
  const result = aggregateDashboard([{ project: 'code', entries: [
    entry('old', '2024-10-01T12:00:00Z'), entry('new', '2026-11-15T01:00:00Z', 20, 'claude-sonnet-4-8'),
  ] }], 'all', 'UTC', '/home/claudeweb', now);
  assert.equal(result.start, '2024-10-01');
  assert.equal(result.summary.sessions, 1);
  assert.equal(result.summary.messages, 2);
  assert.equal(result.summary.total, 48);
  assert.equal(result.summary.tokens.cacheRead, 6);
  assert.equal(result.byModel[0].model, 'claude-sonnet-4-8');
  assert.equal(result.summary.activeDays, 2);
  assert.equal(result.daily.at(-1)?.models[0].total, 29);
});

test('seven local calendar days cross UTC midnight, with peak hour in the viewer zone', () => {
  const result = aggregateDashboard([{ project: 'code', entries: [
    entry('outside', '2026-11-08T15:59:59Z'), entry('inside', '2026-11-08T16:00:00Z'),
    entry('today', '2026-11-14T16:30:00Z'), entry('future', '2026-11-16T00:00:00Z'),
  ] }], '7', 'Asia/Kuala_Lumpur', '/home/claudeweb', now);
  assert.equal(result.start, '2026-11-09');
  assert.equal(result.daily.length, 7);
  assert.equal(result.daily[0].messages, 1);
  assert.equal(result.daily.at(-1)?.messages, 1);
  assert.equal(result.summary.peakHour, 0);
  assert.equal(result.summary.messages, 2);
});

test('code excludes exactly the Chat workspace but preserves its nested project folders', () => {
  const result = aggregateDashboard([
    { project: 'chat', projectDirectory: '-home-claudeweb', entries: [entry('chat', '2026-11-15T01:00:00Z', 900)] },
    { project: 'project', projectDirectory: '-home-claudeweb-projects-api', entries: [entry('code', '2026-11-15T01:00:00Z')] },
  ], '30', 'UTC', '/home/claudeweb', now);
  assert.equal(result.summary.messages, 1);
  assert.equal(result.summary.total, 19);
  assert.equal(result.daily.length, 30);
});

test('repeated streaming/fork snapshots count once using the most complete usage', () => {
  const result = aggregateDashboard([
    { project: 'a', entries: [entry('same', '2026-11-15T01:00:00Z', 1), entry('same', '2026-11-15T01:00:00Z', 100)] },
    { project: 'fork', entries: [entry('same', '2026-11-15T01:00:00Z', 10)] },
  ], 'all', 'UTC', '/home/claudeweb', now);
  assert.equal(result.summary.messages, 1);
  assert.equal(result.summary.sessions, 1);
  assert.equal(result.summary.total, 109);
});

test('no history yields an explicit empty result, not a fabricated active day or model', () => {
  const result = aggregateDashboard([], '7', 'UTC', '/home/claudeweb', now);
  assert.equal(result.summary.peakHour, null);
  assert.equal(result.summary.topModel, null);
  assert.equal(result.summary.activeDays, 0);
  assert.equal(result.daily.length, 7);
  assert.equal(result.summary.total, 0);
});

test('invalid timestamps are skipped, invalid time zones rejected', () => {
  assert.equal(aggregateDashboard([{ project: 'a', entries: [entry('bad', 'not a date')] }], 'all', 'UTC', '/home/claudeweb', now).summary.messages, 0);
  assert.throws(() => aggregateDashboard([], 'all', 'Invalid/Zone', '/home/claudeweb', now), RangeError);
});
