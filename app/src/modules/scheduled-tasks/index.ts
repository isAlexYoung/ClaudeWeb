import { useMemo } from 'react';

import { useScheduledTasks } from '@/modules/scheduled-tasks/useScheduledTasks';

// ScheduledTasksPage: rendered by WorkspaceMain when the sidebar's Scheduled tasks entry is open.
export { default as ScheduledTasksPage } from '@/modules/scheduled-tasks/ScheduledTasksPage';

// The floating menu family (portaled, viewport-aware, Escape closes only the menu): also used by Artefacts.
export {
  ScheduledTaskMenu,
  ScheduledTaskMenuDivider,
  ScheduledTaskMenuItem,
  ScheduledTaskMenuLabel,
  ScheduledTaskSubmenu,
} from '@/modules/scheduled-tasks/ScheduledTaskMenu';

/** Used by the sidebar to mark conversations a scheduled task started with a clock icon. */
export function useScheduledTaskSessionIds(): Set<string> {
  const { tasks } = useScheduledTasks();
  return useMemo(() => new Set(tasks.flatMap((task) => task.runs
    .map((run) => run.sessionId)
    .filter((id): id is string => Boolean(id)))), [tasks]);
}
