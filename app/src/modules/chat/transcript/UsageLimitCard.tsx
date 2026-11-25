import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Check, Gauge, Loader2 } from 'lucide-react';

import type { ScheduledMessage } from '@/shared/types';
import { useUsageLimitResume } from '@/modules/chat/context/UsageLimitResumeContext';
import { USAGE_LIMIT_RESUME_OPTION } from '@/modules/chat/utils/usageLimitNotice';
import type { UsageLimitNotice } from '@/modules/chat/utils/usageLimitNotice';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "1 h 23 min" / "2 d 3 h": the two largest units, rounded up so it never reads zero before the reset. */
function formatTimeLeft(ms: number, t: TFunction): string {
  if (ms < MINUTE) return t('usageLimit.duration.lessThanMinute');
  const minutesTotal = Math.ceil(ms / MINUTE);
  const days = Math.floor(minutesTotal / (24 * 60));
  const hours = Math.floor((minutesTotal % (24 * 60)) / 60);
  const minutes = minutesTotal % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(t('usageLimit.duration.days', { count: days }));
  if (hours > 0) parts.push(t('usageLimit.duration.hours', { count: hours }));
  if (days === 0 && minutes > 0) parts.push(t('usageLimit.duration.minutes', { count: minutes }));
  return parts.slice(0, 2).join(t('usageLimit.duration.separator'));
}

/** The clock ticks once a minute, every second in the last minute, and stops at the reset. */
function useNow(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null || now >= until) return;
    const left = until - now;
    const step = left <= MINUTE ? 1000 : Math.min(MINUTE - (now % MINUTE) + 50, left);
    const timer = setTimeout(() => setNow(Date.now()), step);
    return () => clearTimeout(timer);
  }, [now, until]);
  return now;
}

/** This reset's continue message: the one waiting, else the one sent, else the latest failure. */
function findResumeMessage(messages: ScheduledMessage[], key: string): ScheduledMessage | undefined {
  const mine = messages.filter((message) => message.options?.[USAGE_LIMIT_RESUME_OPTION] === key);
  return mine.find((message) => message.status === 'pending')
    ?? mine.find((message) => message.status === 'sent')
    ?? [...mine].reverse().find((message) => message.status === 'failed');
}

function formatReset(date: Date, language: string, now: number): string {
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(language, {
    ...(date.getTime() - now > 20 * HOUR || date.getTime() < now ? { month: 'short', day: 'numeric', weekday: 'short' } : {}),
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

type UsageLimitCardProps = {
  notice: UsageLimitNotice;
  /** The notice as written, kept as the card's tooltip and for copying. */
  rawText: string;
  /** An exported transcript shows the limit, not the controls. */
  isExporting?: boolean;
};

/**
 * Drawn by MessageComponent in place of Claude Code's "You've hit your limit"
 * message: which limit, when it resets and how long that is from now, and a
 * box that schedules a message to carry on with the task once it has reset.
 * The schedule is an ordinary scheduled message, so it also shows (and can be
 * cancelled) above the composer and is sent by the server even if this page
 * is closed.
 */
export default function UsageLimitCard({ notice, rawText, isExporting = false }: UsageLimitCardProps) {
  const { t, i18n } = useTranslation('chat');
  const resume = useUsageLimitResume();
  const resetsAtMs = notice.resetsAt?.getTime() ?? null;
  const now = useNow(resetsAtMs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = notice.resetsAt?.toISOString() ?? '';
  const resumeMessage = useMemo(
    () => (resume && key ? findResumeMessage(resume.scheduledMessages, key) : undefined),
    [key, resume],
  );

  const title = notice.kind === 'generic'
    ? (notice.label ? t('usageLimit.title.named', { label: notice.label }) : t('usageLimit.title.generic'))
    : t(`usageLimit.title.${notice.kind}`);
  const hasReset = resetsAtMs !== null && now >= resetsAtMs;
  const pending = resumeMessage?.status === 'pending';
  const writtenReset = [notice.resetText, notice.timeZone ? `(${notice.timeZone})` : ''].filter(Boolean).join(' ');

  const toggle = async (checked: boolean) => {
    if (!resume || !notice.resetsAt || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (checked) {
        if (!(await resume.scheduleResume(notice.resetsAt))) setError(t('usageLimit.resume.scheduleFailed'));
      } else if (resumeMessage?.status === 'pending') {
        await resume.cancel(resumeMessage.id);
      }
    } finally {
      setBusy(false);
    }
  };

  let resumeRow: ReactNode = null;
  if (!isExporting && resume && notice.resetsAt) {
    if (resumeMessage?.status === 'sent') {
      resumeRow = (
        <p className="usage-limit-card-status">
          <Check size={14} aria-hidden="true" />
          {t('usageLimit.resume.sent', {
            time: new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(new Date(resumeMessage.scheduledFor)),
          })}
        </p>
      );
    } else if (!hasReset || pending) {
      resumeRow = (
        <label className="usage-limit-card-resume">
          <input
            type="checkbox"
            checked={pending}
            disabled={busy}
            onChange={(event) => { void toggle(event.target.checked); }}
          />
          <span>
            <span className="usage-limit-card-resume-label">
              {t('usageLimit.resume.label')}
              {busy && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
            </span>
            <span className="usage-limit-card-resume-message">“{t('usageLimit.resume.message')}”</span>
          </span>
        </label>
      );
    }
  }
  const failure = !isExporting && resumeMessage?.status === 'failed' ? resumeMessage.failureReason : null;

  return (
    <div className="usage-limit-card" role="group" aria-label={title} title={rawText}>
      <div className="usage-limit-card-head">
        <span className="usage-limit-card-icon" aria-hidden="true"><Gauge size={16} /></span>
        <strong>{title}</strong>
      </div>
      <dl className="usage-limit-card-facts">
        <div>
          <dt>{t('usageLimit.resetsAt')}</dt>
          <dd>
            {notice.resetsAt ? formatReset(notice.resetsAt, i18n.language, now) : writtenReset || t('usageLimit.unknownReset')}
            {notice.resetsAt && notice.timeZone && notice.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
              <span className="usage-limit-card-zone">{writtenReset}</span>
            )}
          </dd>
        </div>
        {resetsAtMs !== null && (
          <div>
            <dt>{t('usageLimit.timeLeft')}</dt>
            <dd className={hasReset ? 'usage-limit-card-done' : undefined}>
              {hasReset ? t('usageLimit.hasReset') : formatTimeLeft(resetsAtMs - now, t)}
            </dd>
          </div>
        )}
      </dl>
      {resumeRow}
      {(error || failure) && <p className="usage-limit-card-error" role="alert">{error ?? t('usageLimit.resume.failed', { reason: failure })}</p>}
    </div>
  );
}
