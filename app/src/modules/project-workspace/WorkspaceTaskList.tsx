import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { useSessionTasks } from '@/shared/sessionTasks';

/** `45s`, `3m 05s`, `1h 02m`: a running task's age, precise enough to watch tick. */
function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/**
 * Rendered by WorkspaceContextInspector under Memory: the session's running
 * background tasks (workflows, agents, backgrounded commands), each with how
 * long it has been running and a button to stop it. Renders nothing while no
 * task runs, which is most of the time.
 */
export default function WorkspaceTaskList({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation('common');
  const { entries, stop } = useSessionTasks(sessionId);
  // The clock the elapsed times are read against; ticks only while tasks run.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (entries.length === 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <section className="workspace-task-list" aria-label={t('workspace.inspector.runningTasks')}>
      <p className="workspace-task-list-label">{t('workspace.inspector.runningTasks')}</p>
      <ul>
        {entries.map((task) => (
          <li key={task.id} className="workspace-task" title={[task.kind, task.name].filter(Boolean).join(' · ')}>
            <span className="workspace-task-dot" aria-hidden="true" />
            <span className="workspace-task-text">
              <span className="workspace-task-name">{task.name || task.kind}</span>
              <small>{task.name ? task.kind : ''}</small>
            </span>
            <span className="workspace-task-elapsed">{formatElapsed(now - task.startedAt)}</span>
            {stop && task.taskId && (
              <button
                type="button"
                className="workspace-task-stop"
                aria-label={t('workspace.inspector.stopTask', { name: task.name || task.kind })}
                title={t('workspace.inspector.stopTask', { name: task.name || task.kind })}
                onClick={() => stop(task.taskId!)}
              >
                <X size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
