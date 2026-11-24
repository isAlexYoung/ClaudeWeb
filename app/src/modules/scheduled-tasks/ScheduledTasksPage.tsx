import { useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown, ChevronDown, ListFilter, MessageCircle, Pause, Pencil, Play, RotateCw, Search, Settings, Trash2, X,
} from 'lucide-react';

import { api } from '@/shared/api';
import { CHAT_WORKSPACE_PATH } from '@/shared/constants';
import type { ScheduledTask, ScheduledTaskInput } from '@/shared/types';
import ScheduledTaskEditor from '@/modules/scheduled-tasks/ScheduledTaskEditor';
import ScheduledTaskTemplates from '@/modules/scheduled-tasks/ScheduledTaskTemplates';
import {
  ScheduledTaskMenu,
  ScheduledTaskMenuDivider,
  ScheduledTaskMenuItem,
  ScheduledTaskMenuLabel,
} from '@/modules/scheduled-tasks/ScheduledTaskMenu';
import { describeSchedule, formatWhen } from '@/modules/scheduled-tasks/scheduleText';
import { readApiError, useScheduledTasks } from '@/modules/scheduled-tasks/useScheduledTasks';

type ScheduledTasksPageProps = {
  /** The workspace's menu button on phones, which opens the sidebar drawer. */
  menuButton?: ReactNode;
  onOpenSession: (sessionId: string) => void;
  /** Opens a new chat with `prompt` already in the composer, for templates and "Create with Claude". */
  onStartChat: (prompt: string) => void;
};

type PageTab = 'mine' | 'templates';
/** Where a task runs: the standalone chat workspace or one of the user's projects. */
type SourceFilter = 'all' | 'chat' | 'project';
/** enabled: will run. paused: switched off by the user. completed: a one-off that ran and switched itself off. shelved: its schedule can no longer be read. */
type TaskState = 'enabled' | 'paused' | 'completed' | 'shelved';
type StateFilter = 'all' | TaskState;
type SortKey = 'next' | 'name';

const SOURCE_FILTERS: SourceFilter[] = ['all', 'chat', 'project'];
const STATE_FILTERS: StateFilter[] = ['all', 'enabled', 'paused', 'completed', 'shelved'];

function taskState(task: ScheduledTask): TaskState {
  if (!task.schedule) return 'shelved';
  if (task.enabled) return 'enabled';
  if (task.schedule.kind === 'once' && task.runs.length > 0) return 'completed';
  return 'paused';
}

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

/** The empty-state stopwatch, drawn in the theme's foreground and bubble colours. */
function StopwatchIllustration() {
  return (
    <svg className="scheduled-tasks-stopwatch" width="96" height="104" viewBox="0 0 96 104" fill="none" aria-hidden="true">
      <rect x="36" y="4" width="24" height="9" rx="2.5" stroke="currentColor" strokeWidth="2.4" />
      <path d="M48 13v8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="48" cy="60" r="39" className="scheduled-tasks-stopwatch-face" stroke="currentColor" strokeWidth="2.4" />
      <path d="M48 36v26l14-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The faint wavy rule between the user's tasks and the template suggestions. */
function WaveDivider() {
  const patternId = useId();
  return (
    <svg className="scheduled-tasks-wave" width="100%" height="10" aria-hidden="true">
      <defs>
        <pattern id={patternId} width="24" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 5 Q6 1 12 5 T24 5" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </pattern>
      </defs>
      <rect width="100%" height="10" fill={`url(#${patternId})`} />
    </svg>
  );
}

/** Rendered by WorkspaceMain in place of a chat when the sidebar's Scheduled tasks entry is open. */
export default function ScheduledTasksPage({ menuButton, onOpenSession, onStartChat }: ScheduledTasksPageProps) {
  const { t, i18n } = useTranslation('sidebar');
  const { tasks, loading, error, refresh } = useScheduledTasks();
  // "My tasks" (the list plus suggestions) or the full template gallery.
  const [tab, setTab] = useState<PageTab>('mine');
  // The search icon turns into a field; closing it also clears the query.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Filter menu choices for the user's list.
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  // Sort menu choices; finished one-off tasks are hidden unless asked for.
  const [sortKey, setSortKey] = useState<SortKey>('next');
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = tasks.filter((task) => {
      const state = taskState(task);
      if (needle && !`${task.name}\n${task.prompt}`.toLocaleLowerCase().includes(needle)) return false;
      if (sourceFilter === 'chat' && task.projectPath !== CHAT_WORKSPACE_PATH) return false;
      if (sourceFilter === 'project' && task.projectPath === CHAT_WORKSPACE_PATH) return false;
      if (stateFilter !== 'all' && state !== stateFilter) return false;
      // Asking for completed tasks in the filter shows them regardless of the sort toggle.
      if (state === 'completed' && !includeCompleted && stateFilter !== 'completed') return false;
      return true;
    });
    const byName = (a: ScheduledTask, b: ScheduledTask) => a.name.localeCompare(b.name, i18n.language);
    return filtered.sort(sortKey === 'name' ? byName : (a, b) => {
      // Tasks with a next run come first, soonest first; the rest follow by name.
      const nextA = a.enabled && a.nextRunAt ? Date.parse(a.nextRunAt) : Number.POSITIVE_INFINITY;
      const nextB = b.enabled && b.nextRunAt ? Date.parse(b.nextRunAt) : Number.POSITIVE_INFINITY;
      return nextA === nextB ? byName(a, b) : nextA - nextB;
    });
  }, [tasks, query, sourceFilter, stateFilter, includeCompleted, sortKey, i18n.language]);
  const filtersActive = sourceFilter !== 'all' || stateFilter !== 'all';

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

  const startWithClaude = () => {
    setEditorOpen(false);
    onStartChat(t('scheduledTasks.withClaudePrompt'));
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

  const openSearch = () => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  const newTaskMenu = (
    <ScheduledTaskMenu
      triggerClassName="scheduled-tasks-new"
      align="end"
      ariaLabel={t('scheduledTasks.newTask')}
      trigger={<><span>{t('scheduledTasks.newTask')}</span><ChevronDown size={14} aria-hidden="true" /></>}
    >
      {(close) => (
        <>
          <ScheduledTaskMenuItem icon={<MessageCircle size={16} />} label={t('scheduledTasks.newTaskWithClaude')} onSelect={() => { close(); startWithClaude(); }} />
          <ScheduledTaskMenuItem icon={<Settings size={16} />} label={t('scheduledTasks.manualSetup')} onSelect={() => { close(); openEditor(null); }} />
        </>
      )}
    </ScheduledTaskMenu>
  );

  const renderTask = (task: ScheduledTask) => {
    const lastRun = task.runs[0];
    const active = lastRun && (lastRun.status === 'queued' || lastRun.status === 'running');
    const busy = busyTaskId === task.id;
    const state = taskState(task);
    return (
      <li key={task.id} className={`scheduled-task-card ${task.enabled ? '' : 'paused'}`}>
        <div className="scheduled-task-main">
          <div className="scheduled-task-title">
            <strong>{task.name}</strong>
            {state !== 'enabled' && <span className="scheduled-task-badge">{t(`scheduledTasks.filter.states.${state}`)}</span>}
            {active && <span className="scheduled-task-badge running">{t(`scheduledTasks.status.${lastRun.status}`)}</span>}
          </div>
          <p className="scheduled-task-meta">
            {describeSchedule(task.schedule, t, i18n.language)}
            {' · '}
            {projectLabel(task.projectPath, t('scheduledTasks.editor.chatWorkspace'))}
            {' · '}
            {t(`scheduledTasks.permission.${task.permission}`)}
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
  };

  return (
    <div className="workspace-main scheduled-tasks-page flex h-full flex-col">
      <div className="scheduled-tasks-scroll">
        <div className="scheduled-tasks-inner">
          <header className="scheduled-tasks-header">
            {menuButton}
            <h1>{t('scheduledTasks.title')}</h1>
          </header>

          <div className="scheduled-tasks-toolbar">
            <div className="scheduled-tasks-tabs" role="tablist" aria-label={t('scheduledTasks.title')}>
              {(['mine', 'templates'] as PageTab[]).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
                  {t(`scheduledTasks.tabs.${value}`)}
                </button>
              ))}
            </div>
            <div className="scheduled-tasks-actions">
              {tab === 'mine' && (searchOpen ? (
                <div className="scheduled-tasks-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    aria-label={t('scheduledTasks.search')}
                    placeholder={t('scheduledTasks.search')}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }}
                  />
                  <button type="button" aria-label={t('scheduledTasks.closeSearch')} onClick={closeSearch}><X size={15} /></button>
                </div>
              ) : (
                <button type="button" className="scheduled-tasks-icon" aria-label={t('scheduledTasks.search')} title={t('scheduledTasks.search')} onClick={openSearch}>
                  <Search size={17} />
                </button>
              ))}
              {tab === 'mine' && (
                <ScheduledTaskMenu
                  triggerClassName={`scheduled-tasks-icon ${filtersActive ? 'active' : ''}`}
                  ariaLabel={t('scheduledTasks.filter.title')}
                  title={t('scheduledTasks.filter.title')}
                  align="end"
                  trigger={<ListFilter size={17} />}
                >
                  {() => (
                    <>
                      <ScheduledTaskMenuLabel>{t('scheduledTasks.filter.source')}</ScheduledTaskMenuLabel>
                      {SOURCE_FILTERS.map((value) => (
                        <ScheduledTaskMenuItem key={value} label={t(`scheduledTasks.filter.sources.${value}`)} selected={sourceFilter === value} onSelect={() => setSourceFilter(value)} />
                      ))}
                      <ScheduledTaskMenuDivider />
                      <ScheduledTaskMenuLabel>{t('scheduledTasks.filter.state')}</ScheduledTaskMenuLabel>
                      {STATE_FILTERS.map((value) => (
                        <ScheduledTaskMenuItem key={value} label={t(`scheduledTasks.filter.states.${value}`)} selected={stateFilter === value} onSelect={() => setStateFilter(value)} />
                      ))}
                    </>
                  )}
                </ScheduledTaskMenu>
              )}
              {tab === 'mine' && (
                <ScheduledTaskMenu
                  triggerClassName="scheduled-tasks-icon"
                  ariaLabel={t('scheduledTasks.sort.title')}
                  title={t('scheduledTasks.sort.title')}
                  align="end"
                  trigger={<ArrowUpDown size={17} />}
                >
                  {() => (
                    <>
                      {(['next', 'name'] as SortKey[]).map((value) => (
                        <ScheduledTaskMenuItem key={value} label={t(`scheduledTasks.sort.${value}`)} selected={sortKey === value} onSelect={() => setSortKey(value)} />
                      ))}
                      <ScheduledTaskMenuDivider />
                      <ScheduledTaskMenuItem label={t('scheduledTasks.sort.includeCompleted')} selected={includeCompleted} onSelect={() => setIncludeCompleted((value) => !value)} />
                    </>
                  )}
                </ScheduledTaskMenu>
              )}
              {newTaskMenu}
            </div>
          </div>

          {tab === 'mine' ? (
            <>
              {(error || actionError) && <p role="alert" className="scheduled-task-error">{actionError || error}</p>}
              {loading && <p role="status" className="scheduled-tasks-status">{t('scheduledTasks.loading')}</p>}
              {!loading && tasks.length === 0 && !error && (
                <div className="scheduled-tasks-empty">
                  <StopwatchIllustration />
                  <p>{t('scheduledTasks.empty')}</p>
                  <button type="button" className="scheduled-tasks-soft-button" onClick={() => openEditor(null)}>{t('scheduledTasks.manualSetup')}</button>
                </div>
              )}
              {!loading && tasks.length > 0 && visibleTasks.length === 0 && (
                <p className="scheduled-tasks-status">{t('scheduledTasks.noMatches')}</p>
              )}
              {visibleTasks.length > 0 && <ul className="scheduled-tasks-list">{visibleTasks.map(renderTask)}</ul>}
              <WaveDivider />
              <ScheduledTaskTemplates onPick={onStartChat} />
            </>
          ) : (
            <ScheduledTaskTemplates onPick={onStartChat} />
          )}
        </div>
      </div>
      <ScheduledTaskEditor
        open={editorOpen}
        task={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => void refresh()}
        onStartWithClaude={startWithClaude}
      />
    </div>
  );
}
