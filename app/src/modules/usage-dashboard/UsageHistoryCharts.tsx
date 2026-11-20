import { useTranslation } from 'react-i18next';

import type { UsageDashboardData } from '@/shared/types';

// Kept in a fixed order by the ranked models, shared by the chart and its legend.
const COLORS = ['#6695ee', '#95b7f6', '#4372ba', '#aecaf6', '#345889', '#c2d4ee'];

/** Used only by UsageDashboard: a compact, keyboard-accessible activity grid for the last 26 weeks. */
export function UsageActivity({ data }: { data: UsageDashboardData }) {
  const { t, i18n } = useTranslation('common');
  const recent = data.daily.slice(-182);
  const byDate = new Map(recent.map((day) => [day.date, day]));
  const days = Array.from({ length: 182 }, (_, index) => {
    const value = new Date(`${data.end}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() - 181 + index);
    const date = value.toISOString().slice(0, 10);
    return { date, day: byDate.get(date) };
  });
  const maximum = Math.max(...recent.map((day) => day.total), 1);
  const first = days[0].date;
  const padding = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const format = new Intl.NumberFormat(i18n.language);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <>
      <div className="usage-activity" role="group" aria-label={t('usageDashboard.activity')}>
        {Array.from({ length: padding }, (_, index) => <span key={`pad-${index}`} aria-hidden="true" />)}
        {days.map(({ date, day }) => {
          if (!day) return <span className="usage-day usage-day-outside" key={date} aria-hidden="true" />;
          const level = day.total === 0 ? 0 : Math.min(4, Math.ceil(Math.sqrt(day.total / maximum) * 4));
          const label = t('usageDashboard.dayUsage', { date: dateFormat.format(new Date(`${day.date}T12:00:00Z`)), tokens: format.format(day.total), count: day.messages });
          return <button key={day.date} type="button" className="usage-day" data-level={level} title={label} aria-label={label} />;
        })}
      </div>
      <div className="usage-activity-caption"><span>{t('usageDashboard.activityWindow')}</span><span>{t('usageDashboard.less')} <i data-level="0" /><i data-level="2" /><i data-level="4" /> {t('usageDashboard.more')}</span></div>
    </>
  );
}

/** Used only by UsageDashboard: model totals and a stacked time series with textual equivalents. */
export function UsageModels({ data }: { data: UsageDashboardData }) {
  const { t, i18n } = useTranslation('common');
  const number = new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 });
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const date = (value: string) => dateFormat.format(new Date(`${value}T12:00:00Z`));
  // Bound SVG work for all-time histories; totals remain all-time, with adjacent days combined.
  const step = Math.max(1, Math.ceil(data.daily.length / 32));
  const buckets = Array.from({ length: Math.ceil(data.daily.length / step) }, (_, index) => {
    const days = data.daily.slice(index * step, (index + 1) * step);
    const values = data.byModel.map((model) => days.reduce((sum, day) =>
      sum + (day.models.find((entry) => entry.model === model.model)?.total ?? 0), 0));
    return { start: days[0].date, end: days[days.length - 1].date, values, total: values.reduce((sum, value) => sum + value, 0) };
  });
  const max = Math.max(...buckets.map((bucket) => bucket.total), 1);
  const width = 524 / Math.max(1, buckets.length);
  return (
    <>
      <svg className="usage-model-chart" viewBox="0 0 600 190" role="img" aria-label={t('usageDashboard.modelChart')}>
        {[0, 0.5, 1].map((fraction) => <g key={fraction}>
          <line x1="56" x2="588" y1={150 - fraction * 132} y2={150 - fraction * 132} className="usage-gridline" />
          <text x="48" y={154 - fraction * 132} textAnchor="end">{number.format(max * fraction)}</text>
        </g>)}
        {buckets.map((bucket, index) => {
          let offset = 0;
          return <g key={bucket.start}>
            <title>{`${date(bucket.start)}${step > 1 ? ` – ${date(bucket.end)}` : ''}: ${number.format(bucket.total)} Token`}</title>
            {bucket.values.map((value, modelIndex) => {
              const height = value / max * 132;
              offset += height;
              return value > 0 ? <rect key={data.byModel[modelIndex].model} x={60 + index * width} y={150 - offset} width={Math.max(1, width - 5)} height={height} fill={COLORS[modelIndex % COLORS.length]} rx="2" /> : null;
            })}
            {(index === 0 || index === buckets.length - 1 || index % Math.max(1, Math.ceil(buckets.length / 5)) === 0) &&
              <text x={60 + index * width + width / 2} y="174" textAnchor="middle">{date(bucket.start)}</text>}
          </g>;
        })}
      </svg>
      {step > 1 && <div className="usage-caption">{t('usageDashboard.groupedDays', { count: step })}</div>}
      <div className="usage-model-list" aria-label={t('usageDashboard.modelBreakdown')}>
        {data.byModel.map((model, index) => <div className="usage-model-row" key={model.model}>
          <span className="usage-model-name"><i style={{ background: COLORS[index % COLORS.length] }} />{model.model.replace(/^claude-/, '')}</span>
          <span>{t('usageDashboard.inputOutput', { input: number.format(model.tokens.input), output: number.format(model.tokens.output) })}
            <small>{t('usageDashboard.cacheCounts', { read: number.format(model.tokens.cacheRead), write: number.format(model.tokens.cacheCreate) })}</small>
          </span>
          <strong>{(data.summary.total ? model.total / data.summary.total * 100 : 0).toFixed(1)}%</strong>
        </div>)}
      </div>
    </>
  );
}
