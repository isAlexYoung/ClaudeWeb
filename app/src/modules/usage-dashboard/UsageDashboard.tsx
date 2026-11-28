import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

import { api } from '@/shared/api';
import { CHAT_WORKSPACE_PATH } from '@/shared/constants';
import type { UsageDashboardData, UsageDashboardRange } from '@/shared/types';
import { useWorkspaceProfile } from '@/shared/workspacePreferences';
import { QuotaDetails } from '@/shared/ui';
import { useSubscriptionQuota } from '@/shared/context/SubscriptionQuotaContext';
import { ClawdHeading } from '@/modules/clawd';
import { UsageActivity, UsageModels } from '@/modules/usage-dashboard/UsageHistoryCharts';
import '@/modules/usage-dashboard/usage-dashboard.css';

type Tab = 'overview' | 'models' | 'quota';
const TABS: Tab[] = ['overview', 'models', 'quota'];
const RANGES: UsageDashboardRange[] = ['all', '30', '7'];

/** Used by project-workspace's Code-mode landing page; local history and subscription quota fail independently. */
export function UsageDashboard() {
  const { t, i18n } = useTranslation('common');
  const profile = useWorkspaceProfile();
  const quota = useSubscriptionQuota();
  const id = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  // The active view is local to this landing card, without changing project or conversation navigation.
  const [tab, setTab] = useState<Tab>('overview');
  // Period controls apply to history only; the quota tab always shows live subscription windows.
  const [range, setRange] = useState<UsageDashboardRange>('all');
  // Key each settled response so an older period can never appear under the newly selected filter.
  const [history, setHistory] = useState<{ key: string; data?: UsageDashboardData; error?: boolean } | null>(null);
  // Incrementing restarts only the local-history request.
  const [retry, setRetry] = useState(0);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const requestKey = `${range}:${timeZone}:${retry}`;
  const loading = history?.key !== requestKey;
  const error = history?.key === requestKey && history.error;
  const data = history?.key === requestKey ? history.data : null;
  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async (attempt = 0) => {
      let retryable = true;
      try {
        const response = await api.usageDashboard(range, timeZone, CHAT_WORKSPACE_PATH);
        if (!active) return;
        retryable = response.status >= 500;
        if (!response.ok) throw new Error(`History HTTP ${response.status}`);
        retryable = false;
        const result = await response.json() as UsageDashboardData;
        if (!result.summary || !Array.isArray(result.daily) || !Array.isArray(result.byModel)) throw new Error('Invalid history response');
        if (active) setHistory({ key: requestKey, data: result });
      } catch (error) {
        if (!active) return;
        // A plugin can be restarting when the landing page opens. Retry once,
        // but never loop on missing/disabled plugins or authentication errors.
        if (retryable && attempt === 0) {
          retryTimer = setTimeout(() => { void load(1); }, 750);
          return;
        }
        console.warn('[Usage dashboard] Local history request failed:', error);
        setHistory({ key: requestKey, error: true });
      }
    };
    void load();
    return () => { active = false; clearTimeout(retryTimer); };
  }, [range, timeZone, requestKey]);
  const number = new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat(i18n.language);
  const summary = data?.summary;
  const cells = summary ? [
    [t('usageDashboard.sessions'), integer.format(summary.sessions)],
    [t('usageDashboard.messages'), integer.format(summary.messages)],
    [t('usageDashboard.total'), number.format(summary.total)],
    [t('usageDashboard.activeDays'), integer.format(summary.activeDays)],
    [t('usageDashboard.peakHour'), summary.peakHour === null ? '—' : new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, summary.peakHour)))],
    [t('usageDashboard.topModel'), summary.topModel?.replace(/^claude-/, '') ?? '—'],
  ] : [];
  return (
    <div className="usage-home">
      <ClawdHeading mode="code"><h1 className="usage-greeting"><Sparkles aria-hidden="true" />{t(profile.displayName.trim() ? 'usageDashboard.greetingNamed' : 'usageDashboard.greeting', { name: profile.displayName.trim() })}</h1></ClawdHeading>
      <section className="usage-dashboard" aria-label={t('usageDashboard.title')}>
        <div className="usage-toolbar">
          <div role="tablist" aria-label={t('usageDashboard.title')} ref={tabsRef} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const current = TABS.indexOf(tab);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (current + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
            setTab(TABS[next]);
            tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}>
            {TABS.map((value) => <button key={value} id={`${id}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${id}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{t(`usageDashboard.${value}`)}</button>)}
          </div>
          {tab !== 'quota' && <div className="usage-ranges" role="group" aria-label={t('usageDashboard.period')}>
            {RANGES.map((value) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{t(`usageDashboard.range${value}`)}</button>)}
          </div>}
        </div>
        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
          {tab === 'quota' ? <>
            <div className="usage-caption">{t('usageDashboard.quotaNote')}</div>
            {quota.loading && <div role="status">{t('usageDashboard.loadingQuota')}</div>}
            <QuotaDetails />
          </> : loading ? <div className="usage-skeleton" role="status" aria-label={t('usageDashboard.loading')}><div /><div /><div /><span className="sr-only">{t('usageDashboard.loading')}</span></div>
            : error ? <div className="usage-empty" role="status"><span>{t('usageDashboard.error')}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>{t('buttons.retry')}</button></div>
              : !data || !summary?.messages ? <div className="usage-empty" role="status">{t('usageDashboard.empty')}</div>
                : tab === 'overview' ? <>
                  <dl className="usage-summary">{cells.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
                  <UsageActivity data={data} />
                  <div className="usage-token-details">{t('usageDashboard.tokenCounts', { input: number.format(summary.tokens.input), output: number.format(summary.tokens.output), cache: number.format(summary.tokens.cacheRead + summary.tokens.cacheCreate) })}</div>
                </> : <UsageModels data={data} />}
        </div>
        <footer>{t('usageDashboard.scope', { timeZone })}</footer>
      </section>
    </div>
  );
}
