import type { TFunction } from 'i18next';

import type { ScheduledTaskSchedule } from '@/shared/types';

/** Local date and time for lists: "11-20 09:00" style, in the viewer's zone. */
export function formatWhen(iso: string | null, language: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Monday to Friday, the days a "Weekdays" schedule runs on. */
export const WORKDAYS = [1, 2, 3, 4, 5];

/** Whether a weekly schedule's days are exactly Monday to Friday, shown as "Weekdays". */
export function isWorkdays(days: number[]): boolean {
  return days.length === WORKDAYS.length && WORKDAYS.every((day) => days.includes(day));
}

/** One line describing when a task runs, e.g. "Every day at 09:00". */
export function describeSchedule(schedule: ScheduledTaskSchedule | null, t: TFunction, language: string): string {
  if (!schedule) return t('scheduledTasks.schedule.unreadable');
  switch (schedule.kind) {
    case 'once':
      return t('scheduledTasks.schedule.onceAt', { when: formatWhen(schedule.at, language) });
    case 'daily':
      return t('scheduledTasks.schedule.dailyAt', { time: schedule.time });
    case 'weekly':
      if (isWorkdays(schedule.days)) return t('scheduledTasks.schedule.weekdaysAt', { time: schedule.time });
      return t('scheduledTasks.schedule.weeklyAt', {
        days: schedule.days.map((day) => t(`scheduledTasks.weekdays.${day}`)).join(t('scheduledTasks.schedule.daySeparator')),
        time: schedule.time,
      });
    case 'interval':
      return t('scheduledTasks.schedule.everyHours', { count: schedule.hours });
  }
}
