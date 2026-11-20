import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, MessageCircle, Pause, Pencil, Play, Plus, RotateCw, Trash2 } from 'lucide-react';

import { api } from '@/shared/api';
import { CHAT_WORKSPACE_PATH } from '@/shared/constants';
import type { ScheduledTask, ScheduledTaskInput } from '@/shared/types';
import ScheduledTaskEditor from '@/modules/scheduled-tasks/ScheduledTaskEditor';
import { describeSchedule, formatWhen } from '@/modules/scheduled-tasks/scheduleText';
import { readApiError, useScheduledTasks } from '@/modules/scheduled-tasks/useScheduledTasks';

type ScheduledTasksPageProps = {
  /** The workspace's menu button on phones, which opens the sidebar drawer. */
  menuButton?: ReactNode;
  onOpenSession: (sessionId: string) => void;
};

function projectLabel(projectPath: string, chatLabel: string): string {
  if (projectPath === CHAT_WORKSPACE_PATH) return chatLabel;
  return projectPath.split('/').filter(Boolean).pop() || projectPath;
}

/** The same fields a task was saved with, for pausing or resuming it without opening the editor. */
function asInput(task: ScheduledTask, enabled: boolean): ScheduledTaskInput | null {
  if (!task.schedule) return null;
  return {
    name: task.name,
    projectPath: task.projectPath,
    prompt: task.prompt,
    schedule: task.schedule,
    timezone: task.timezone,
    model: task.model,
    permission: task.permission,
    // No tool lists: the server keeps the ones saved with the task.
    enabled,
  };
}

/** Rendered by WorkspaceMain in place of a chat when the sidebar's Scheduled tasks entry is open. */
export default function ScheduledTasksPage({ menuButton, onOpenSession }: ScheduledTasksPageProps) {
  const { t, i18n } = useTranslation('sidebar');
  const { tasks, loading, error, refresh } = useScheduledTasks();
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const act = async (taskId: string, request: () => Promise<Response>) => {
    setBusyTaskId(taskId);
    setActionError(null);
    try {
      const response = await request();
      if (!response.ok) throw new Error(await readApiError(response));
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyTaskId(null);
    }
  };

  const openEditor = (task: ScheduledTask | null) => {
    setEditing(task);
    setEditorOpen(true);
  };

  const remove = (task: ScheduledTask) => {
    if (!window.confirm(t('scheduledTasks.confirmDelete', { name: task.name }))) return;
    void act(task.id, () => api.scheduledTasks.remove(task.id));
  };

  const setEnabled = (task: ScheduledTask, enabled: boolean) => {
    const input = asInput(task, enabled);
    if (!input) {
      openEditor(task);
      return;
    }
    void act(task.id, () => api.scheduledTasks.update(task.id, input));
  };

  return (
    <div className="workspace-main scheduled-tasks-page flex h-full flex-col">
      <header className="scheduled-tasks-header">
        {menuButton}
        <h1><Clock size={20} />{t('scheduledTasks.title')}</h1>
        <button className="scheduled-tasks-new" onClick={() => openEditor(null)}>
          <Plus size={16} />{t('scheduledTasks.newTask')}
        </button>
      </header>
      <div className="scheduled-tasks-body">
        <p className="scheduled-tasks-intro">{t('scheduledTasks.intro')}</p>
        {(error || actionError) && <p role="alert" className="scheduled-task-error">{actionError || error}</p>}
        {loading && <p role="status" className="scheduled-tasks-empty">{t('scheduledTasks.loading')}</p>}
        {!loading && tasks.length === 0 && !error && (
          <div className="scheduled-tasks-empty">
            <p>{t('scheduledTasks.empty')}</p>
            <button className="scheduled-tasks-new" onClick={() => openEditor(null)}><Plus size={16} />{t('scheduledTasks.newTask')}</button>
          </div>
        )}
        <ul className="scheduled-tasks-list">
          {tasks.map((task) => {
            const lastRun = task.runs[0];
            const active = lastRun && (lastRun.status === 'queued' || lastRun.status === 'running');
            const busy = busyTaskId === task.id;
            return (
              <li key={task.id} className={`scheduled-task-card ${task.enabled ? '' : 'paused'}`}>
                <div className="scheduled-task-main">
                  <div className="scheduled-task-title">
                    <strong>{task.name}</strong>
                    {!task.enabled && <span className="scheduled-task-badge">{t('scheduledTasks.paused')}</span>}
                    {active && <span className="scheduled-task-badge running">{t(`scheduledTasks.status.${lastRun.status}`)}</span>}
                  </div>
                  <p className="scheduled-task-meta">
                    {describeSchedule(task.schedule, t, i18n.language)}
                    {' · '}
                    {projectLabel(task.projectPath, t('scheduledTasks.editor.chatWorkspace'))}
                    {' · '}
                    {task.permission === 'all' ? t('scheduledTasks.permission.allShort') : t('scheduledTasks.permission.editsShort')}
                  </p>
                  <p className="scheduled-task-meta">
                    {task.enabled && task.nextRunAt
                      ? t('scheduledTasks.nextRun', { when: formatWhen(task.nextRunAt, i18n.language) })
                      : t('scheduledTasks.noNextRun')}
                    {lastRun && !active && (
                      <>
                        {' · '}
                        <span className={lastRun.status === 'failed' ? 'scheduled-task-failed' : ''}>
                          {t('scheduledTasks.lastRun', {
                            when: formatWhen(lastRun.startedAt, i18n.language),
                            status: t(`scheduledTasks.status.${lastRun.status}`),
                          })}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="scheduled-task-tools">
                  <button title={t('scheduledTasks.runNow')} aria-label={t('scheduledTasks.runNow')} disabled={busy || Boolean(active)}
                    onClick={() => void act(task.id, () => api.scheduledTasks.runNow(task.id))}>
                    <Play size={15} />
                  </button>
                  {task.enabled ? (
                    <button title={t('scheduledTasks.pause')} aria-label={t('scheduledTasks.pause')} disabled={busy} onClick={() => setEnabled(task, false)}>
                      <Pause size={15} />
                    </button>
                  ) : (
                    <button title={t('scheduledTasks.resume')} aria-label={t('scheduledTasks.resume')} disabled={busy} onClick={() => setEnabled(task, true)}>
                      <RotateCw size={15} />
                    </button>
                  )}
                  <button title={t('scheduledTasks.edit')} aria-label={t('scheduledTasks.edit')} disabled={busy} onClick={() => openEditor(task)}>
                    <Pencil size={15} />
                  </button>
                  <button title={t('scheduledTasks.delete')} aria-label={t('scheduledTasks.delete')} disabled={busy} onClick={() => remove(task)}>
                    <Trash2 size={15} />
                  </button>
                </div>
                {task.runs.length > 0 && (
                  <div className="scheduled-task-history">
                    <button className="scheduled-task-history-toggle" aria-expanded={expanded === task.id}
                      onClick={() => setExpanded(expanded === task.id ? null : task.id)}>
                      {t('scheduledTasks.history', { count: task.runs.length })}
                    </button>
                    {expanded === task.id && (
                      <ul>
                        {task.runs.map((run) => (
                          <li key={run.id}>
                            <button disabled={!run.sessionId} onClick={() => run.sessionId && onOpenSession(run.sessionId)}>
                              <MessageCircle size={14} />
                              <span>{formatWhen(run.startedAt, i18n.language)}</span>
                              <span className={run.status === 'failed' ? 'scheduled-task-failed' : ''}>{t(`scheduledTasks.status.${run.status}`)}</span>
                              {run.source === 'manual' && <span className="scheduled-task-badge">{t('scheduledTasks.manual')}</span>}
                            </button>
                            {run.error && <p className="scheduled-task-run-error">{run.error}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <ScheduledTaskEditor open={editorOpen} task={editing} onClose={() => setEditorOpen(false)} onSaved={() => void refresh()} />
    </div>
  );
}
