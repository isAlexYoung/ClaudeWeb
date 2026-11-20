import { useTranslation } from 'react-i18next';

import { useNow } from '@/shared/hooks/useNow';
import { formatExactTime, formatRelativeTime } from '@/shared/timeFormat';
import { Tooltip } from '@/shared/ui';

/**
 * When a message was written, as "just now", "30 minutes ago", "2 hours ago";
 * resting the pointer on it shows the exact date and minute in the viewer's
 * time zone. An exported transcript is read later, so it gets the exact time.
 *
 * Used by MessageComponent under user messages and in the assistant footer;
 * it passes `exact` when the transcript is being exported.
 */
export default function MessageTime({ timestamp, exact = false }: {
  timestamp: string | number | Date | null | undefined;
  exact?: boolean;
}) {
  const { t, i18n } = useTranslation('chat');
  const now = useNow();
  if (timestamp === null || timestamp === undefined || timestamp === '') return null;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const full = formatExactTime(date, i18n.language);
  if (exact) {
    return <time className="workspace-message-time" dateTime={date.toISOString()}>{full}</time>;
  }
  const relative = formatRelativeTime(date, now, i18n.language) ?? t('messageTime.justNow');
  return (
    <Tooltip content={full}>
      <time className="workspace-message-time" dateTime={date.toISOString()} aria-label={full}>{relative}</time>
    </Tooltip>
  );
}
