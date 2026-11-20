import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSubscriptionQuota } from '@/shared/context/SubscriptionQuotaContext';
import { useNow } from '@/shared/hooks/useNow';
import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import { formatExactTime, formatResetTime } from '@/shared/timeFormat';

// Ring geometry in the 24x24 viewBox.
const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type QuotaLimit = { kind: string; label: string; percent: number; resetsAt: string | null };

const toneFor = (percent: number | null) => {
  if (percent === null) return 'unknown';
  if (percent > 90) return 'red';
  if (percent > 70) return 'yellow';
  return 'blue';
};

const clampPercent = (percent: number) => Math.max(0, Math.min(100, percent));

// Known quota windows use the UI language; model names and unknown plugin windows remain intact.
function useQuotaLabel() {
  const { t } = useTranslation('common');
  return (limit: { kind: string; label: string }) => {
    if (limit.kind === 'session') return t('workspace.quota.session');
    if (['weekly', 'weekly_all', 'weekly_scoped'].includes(limit.kind)) {
      const model = limit.label.split('—')[1]?.trim();
      return model ? t('workspace.quota.modelWeekly', { model }) : t('workspace.quota.weekly');
    }
    return limit.label;
  };
}

/** The plan name as the plugin reports it, capitalised for display ("pro" -> "Pro"). */
const planName = (plan: string | null) => (plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null);

/**
 * One row per quota window: its name, when it resets and how much is used,
 * over a bar. `exact` spells the reset out in full (the Settings page); the
 * popover keeps it short.
 */
function QuotaBars({ limits, exact = false }: { limits: QuotaLimit[]; exact?: boolean }) {
  const { t, i18n } = useTranslation('common');
  const quotaLabel = useQuotaLabel();
  const now = useNow();

  return (
    <div className="workspace-quota-bars">
      {limits.map((limit) => {
        const percent = clampPercent(limit.percent);
        let reset: string | null = null;
        if (limit.resetsAt) {
          if (exact) {
            reset = t('workspace.quota.resetsAt', { time: formatExactTime(limit.resetsAt, i18n.language) });
          } else {
            const short = formatResetTime(limit.resetsAt, now, i18n.language);
            reset = t(short.today ? 'workspace.quota.resetsToday' : 'workspace.quota.resetsOn', { time: short.text });
          }
        }
        return (
          <div className="workspace-quota-bar-row" key={`${limit.kind}-${limit.label}`} data-tone={toneFor(percent)}>
            <div className="workspace-quota-bar-head">
              <span>{quotaLabel(limit)}</span>
              {reset && !exact && <small>{reset}</small>}
              <strong>{percent.toFixed(0)}%</strong>
            </div>
            <div className="workspace-quota-bar" role="progressbar" aria-label={quotaLabel(limit)}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
              <i style={{ width: `${percent}%` }} />
            </div>
            {/* The full date is long: below the bar, so the window's name keeps its line. */}
            {reset && exact && <small className="workspace-quota-reset">{reset}</small>}
          </div>
        );
      })}
    </div>
  );
}

/** States shared by both views: loading, nothing to show, a failed or stale reading. */
function QuotaNotes({ showLoading = true }: { showLoading?: boolean }) {
  const { t } = useTranslation('common');
  const quota = useSubscriptionQuota();
  return (
    <>
      {quota.error && <p role="status" className="workspace-quota-note">{quota.error}</p>}
      {showLoading && !quota.error && quota.loading && <p role="status" className="workspace-quota-note">{t('workspace.quota.loading')}</p>}
      {!quota.error && !quota.loading && !quota.limits.length && <p role="status" className="workspace-quota-note">{t('workspace.quota.noData')}</p>}
      {quota.stale && <small className="workspace-quota-note">{t('workspace.quota.staleNote')}</small>}
    </>
  );
}

/**
 * Used by chat's composer for the live subscription quota; an unknown value
 * never becomes a made-up percentage. Clicking it opens the plan's limits in
 * a popover above it; "See all" opens Settings > Usage.
 */
export function QuotaRing({ onSeeAll }: { onSeeAll?: () => void }) {
  const { t } = useTranslation('common');
  const quota = useSubscriptionQuota();
  const quotaLabel = useQuotaLabel();
  const [open, setOpen] = useState(false);
  const { isPresent, presenceProps } = useSurfacePresence(open);
  const root = useRef<HTMLDivElement>(null);
  const limit = quota.limits.find((item) => item.kind === 'session') || quota.limits[0];
  const percent = limit ? clampPercent(limit.percent) : null;
  const label = percent === null
    ? (quota.loading ? t('workspace.quota.loading') : t('workspace.quota.unavailable'))
    : t(quota.stale ? 'workspace.quota.ringStale' : 'workspace.quota.ring', { window: quotaLabel(limit), percent: percent.toFixed(0) });
  const plan = planName(quota.plan);

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="workspace-quota-anchor" ref={root}>
      <button
        type="button"
        className="workspace-quota-ring"
        data-tone={toneFor(percent)}
        onClick={() => { if (!open) quota.refresh(); setOpen((value) => !value); }}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={quota.loading}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r={RING_RADIUS} className="quota-track" />
          {percent !== null && (
            <circle
              cx="12"
              cy="12"
              r={RING_RADIUS}
              className="quota-fill"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
            />
          )}
        </svg>
        {percent === null && <span aria-hidden="true">?</span>}
      </button>
      {isPresent && (
        <div {...presenceProps} className="workspace-quota-popover motion-surface" role="dialog" aria-label={t('workspace.quota.planTitle')}>
          <div className="workspace-quota-popover-head">
            <span>{plan ? `${t('workspace.quota.planTitle')} · ${plan}` : t('workspace.quota.planTitle')}</span>
            {onSeeAll && (
              <button type="button" onClick={() => { setOpen(false); onSeeAll(); }}>
                {t('workspace.quota.seeAll')}
              </button>
            )}
          </div>
          <QuotaBars limits={quota.limits} />
          {/* Keep the cached bars in place without adding a temporary loading row. */}
          <QuotaNotes showLoading={false} />
        </div>
      )}
    </div>
  );
}

/** Used by Settings > Usage: every quota window with its exact reset time, and a manual refresh. */
export function QuotaDetails() {
  const { t } = useTranslation('common');
  const quota = useSubscriptionQuota();
  const plan = planName(quota.plan);

  return (
    <div className="workspace-quota-details">
      {plan && <p className="workspace-quota-plan">{t('workspace.quota.planTitle')} · {plan}</p>}
      <QuotaBars limits={quota.limits} exact />
      <QuotaNotes />
      <p className="workspace-quota-note">{t('workspace.quota.refreshNote')}</p>
      <button type="button" onClick={quota.refresh}>{t('workspace.quota.refresh')}</button>
    </div>
  );
}
