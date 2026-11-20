import type { SessionEntries, UsageEntry } from './history.js';

type Tokens = UsageEntry['tokens'];
type Model = { model: string; tokens: Tokens; total: number };
type Day = { date: string; tokens: Tokens; total: number; messages: number; models: Model[] };

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
const total = (tokens: Tokens): number => Object.values(tokens).reduce((sum, value) => sum + value, 0);
const add = (target: Tokens, source: Tokens): void => {
  for (const key of Object.keys(target) as (keyof Tokens)[]) target[key] += source[key];
};
const clean = (tokens: Tokens): Tokens => Object.fromEntries(Object.entries(tokens).map(([key, value]) =>
  [key, Number.isFinite(value) && value > 0 ? value : 0])) as Tokens;

function shiftDate(date: string, offset: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

/** Used by the plugin's /dashboard route: code history, deduplicated and bucketed in the viewer's time zone. */
export function aggregateDashboard(
  sessions: SessionEntries[],
  range: 'all' | '30' | '7',
  timeZone: string,
  excludedProjectPath: string,
  nowMs = Date.now(),
) {
  // Validate at the boundary; an invalid zone is a request error, never silently interpreted as UTC.
  const calendar = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  const dateOf = (date: number): string => {
    const parts = calendar.formatToParts(date);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const today = dateOf(nowMs);
  const cutoff = range === 'all' ? null : shiftDate(today, -(Number(range) - 1));
  const excluded = excludedProjectPath.replace(/[^a-zA-Z0-9]/g, '-');
  const unique = new Map<string, { entry: UsageEntry; session: number; date: string; timestamp: number }>();
  sessions.forEach((session, index) => {
    if (session.projectDirectory === excluded) return;
    for (const raw of session.entries) {
      const timestamp = Date.parse(raw.timestamp);
      if (!Number.isFinite(timestamp) || timestamp > nowMs || timestamp < 0) continue;
      const date = dateOf(timestamp);
      if (cutoff && date < cutoff) continue;
      const entry = { ...raw, tokens: clean(raw.tokens) };
      const previous = unique.get(entry.id);
      // Streaming snapshots and forked transcripts can repeat an id. Keep the most complete snapshot once.
      if (!previous || total(entry.tokens) >= total(previous.entry.tokens)) {
        unique.set(entry.id, { entry, session: previous?.session ?? index, date, timestamp });
      }
    }
  });
  const models = new Map<string, Model>();
  const days = new Map<string, Day>();
  const hours = Array<number>(24).fill(0);
  const activeSessions = new Set<number>();
  const tokens = zero();
  for (const { entry, session, date, timestamp } of unique.values()) {
    activeSessions.add(session);
    add(tokens, entry.tokens);
    hours[Number(clock.format(timestamp))]++;
    const model = models.get(entry.model) ?? { model: entry.model, tokens: zero(), total: 0 };
    add(model.tokens, entry.tokens);
    model.total = total(model.tokens);
    models.set(entry.model, model);
    const day = days.get(date) ?? { date, tokens: zero(), total: 0, messages: 0, models: [] };
    add(day.tokens, entry.tokens);
    day.total = total(day.tokens);
    day.messages++;
    const dayModel = day.models.find((item) => item.model === entry.model);
    if (dayModel) {
      add(dayModel.tokens, entry.tokens);
      dayModel.total = total(dayModel.tokens);
    } else day.models.push({ model: entry.model, tokens: { ...entry.tokens }, total: total(entry.tokens) });
    days.set(date, day);
  }
  const byModel = [...models.values()].sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
  const start = cutoff ?? [...days.keys()].sort()[0] ?? today;
  const daily: Day[] = [];
  for (let date = start; date <= today; date = shiftDate(date, 1)) {
    daily.push(days.get(date) ?? { date, tokens: zero(), total: 0, messages: 0, models: [] });
  }
  return {
    range, timeZone, start, end: today,
    summary: { sessions: activeSessions.size, messages: unique.size, tokens, total: total(tokens),
      activeDays: days.size, peakHour: unique.size ? hours.indexOf(Math.max(...hours)) : null,
      topModel: byModel[0]?.model ?? null },
    daily, byModel,
  };
}
