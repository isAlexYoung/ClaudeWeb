import { useTranslation } from 'react-i18next';
import { Binoculars, CalendarDays, Clock, Lightbulb, ListChecks, Mailbox, Sunrise } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ScheduledTaskSchedule } from '@/shared/types';
import { WORKDAYS, describeSchedule } from '@/modules/scheduled-tasks/scheduleText';

type ScheduledTaskTemplate = {
  /** Key under `scheduledTasks.templates` for the name, description and chat prompt. */
  id: 'dailyBriefing' | 'inboxTriage' | 'meetingPrep' | 'weeklyReview' | 'contentIdeas' | 'topicWatch';
  icon: LucideIcon;
  /** When the suggested task would run; shown on the card and described in the prompt. */
  schedule: ScheduledTaskSchedule;
};

/** The suggestions shown under "My tasks" and on the Templates tab, in display order. */
const TEMPLATES: ScheduledTaskTemplate[] = [
  { id: 'dailyBriefing', icon: Sunrise, schedule: { kind: 'weekly', days: WORKDAYS, time: '08:00' } },
  { id: 'inboxTriage', icon: Mailbox, schedule: { kind: 'weekly', days: WORKDAYS, time: '08:00' } },
  { id: 'meetingPrep', icon: CalendarDays, schedule: { kind: 'weekly', days: WORKDAYS, time: '08:00' } },
  { id: 'weeklyReview', icon: ListChecks, schedule: { kind: 'weekly', days: [5], time: '16:00' } },
  { id: 'contentIdeas', icon: Lightbulb, schedule: { kind: 'weekly', days: [1], time: '09:00' } },
  { id: 'topicWatch', icon: Binoculars, schedule: { kind: 'daily', time: '09:00' } },
];

type ScheduledTaskTemplatesProps = {
  /** Receives the template's ready-made prompt; the page opens a new chat with it typed in. */
  onPick: (prompt: string) => void;
};

/** Rendered by ScheduledTasksPage below the user's tasks and as the whole Templates tab. */
export default function ScheduledTaskTemplates({ onPick }: ScheduledTaskTemplatesProps) {
  const { t, i18n } = useTranslation('sidebar');
  return (
    <ul className="scheduled-task-templates" aria-label={t('scheduledTasks.tabs.templates')}>
      {TEMPLATES.map(({ id, icon: Icon, schedule }) => {
        const when = describeSchedule(schedule, t, i18n.language);
        return (
          <li key={id}>
            <button
              type="button"
              className="scheduled-task-template"
              onClick={() => onPick(t(`scheduledTasks.templates.${id}.prompt`, { when }))}
            >
              <span className="scheduled-task-template-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.6} /></span>
              <span className="scheduled-task-template-text">
                <strong>{t(`scheduledTasks.templates.${id}.name`)}</strong>
                <span>{t(`scheduledTasks.templates.${id}.description`)}</span>
                <small><Clock size={13} aria-hidden="true" />{when}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
