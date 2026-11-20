import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { CHAT_WORKSPACE_PATH, PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { readUserPreference } from '@/shared/userSettings';
import type {
  Project,
  ProviderModelOption,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskPermission,
  ScheduledTaskSchedule,
} from '@/shared/types';
import { readApiError } from '@/modules/scheduled-tasks/useScheduledTasks';

type ScheduleKind = ScheduledTaskSchedule['kind'];

type ScheduledTaskEditorProps = {
  open: boolean;
  /** The task being edited, or null to create one. */
  task: ScheduledTask | null;
  onClose: () => void;
  onSaved: () => void;
};

/** `datetime-local` value for a Date, in the browser's zone. */
function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inAnHour(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return toLocalInput(date);
}

/** Week starts on Monday in the picker; values stay 0 = Sunday ... 6 = Saturday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Rendered by ScheduledTasksPage to create or edit one task. */
export default function ScheduledTaskEditor({ open, task, onClose, onSaved }: ScheduledTaskEditorProps) {
  const { t } = useTranslation('sidebar');
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState(CHAT_WORKSPACE_PATH);
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<ScheduleKind>('daily');
  const [time, setTime] = useState('09:00');
  const [days, setDays] = useState<number[]>([1]);
  const [hours, setHours] = useState(6);
  const [onceAt, setOnceAt] = useState(inAnHour);
  const [model, setModel] = useState('');
  const [permission, setPermission] = useState<ScheduledTaskPermission>('edits');
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<ProviderModelOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The form starts from the task (or blank) each time it opens.
  useEffect(() => {
    if (!open) return;
    const schedule = task?.schedule;
    setName(task?.name ?? '');
    setProjectPath(task?.projectPath ?? CHAT_WORKSPACE_PATH);
    setPrompt(task?.prompt ?? '');
    setKind(schedule?.kind ?? 'daily');
    setTime(schedule && 'time' in schedule ? schedule.time : '09:00');
    setDays(schedule?.kind === 'weekly' ? schedule.days : [1]);
    setHours(schedule?.kind === 'interval' ? schedule.hours : 6);
    setOnceAt(schedule?.kind === 'once' ? toLocalInput(new Date(schedule.at)) : inAnHour());
    setModel(task?.model ?? '');
    setPermission(task?.permission ?? 'edits');
    setError(null);
    setSaving(false);
  }, [open, task]);

  // Projects and models are read when the form opens; neither is needed before.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [projectsResponse, modelsResponse] = await Promise.all([api.projects(), api.providers.models('claude')]);
        const projectList = projectsResponse.ok ? ((await projectsResponse.json()) as Project[]) : [];
        const modelBody = modelsResponse.ok ? await modelsResponse.json() : null;
        if (cancelled) return;
        setProjects(Array.isArray(projectList) ? projectList : []);
        setModels(Array.isArray(modelBody?.data?.models) ? modelBody.data.models : []);
      } catch {
        // The form still works with the chat workspace and the default model.
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const projectOptions = projects.filter((project) => project.fullPath && project.fullPath !== CHAT_WORKSPACE_PATH && !project.isArchived);
  const projectKnown = projectPath === CHAT_WORKSPACE_PATH || projectOptions.some((project) => project.fullPath === projectPath);

  const buildSchedule = (): ScheduledTaskSchedule => {
    switch (kind) {
      case 'once': return { kind, at: new Date(onceAt).toISOString() };
      case 'daily': return { kind, time };
      case 'weekly': return { kind, time, days };
      case 'interval': return { kind, hours };
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (kind === 'once' && Number.isNaN(new Date(onceAt).getTime())) {
      setError(t('scheduledTasks.editor.pickDate'));
      return;
    }
    const tools = readUserPreference<{ allowedTools?: string[]; disallowedTools?: string[] }>(
      PROVIDER_PERMISSION_PREFERENCE_KEYS.claude,
      { allowedTools: [], disallowedTools: [] },
    );
    const input: ScheduledTaskInput = {
      name: name.trim(),
      projectPath,
      prompt,
      schedule: buildSchedule(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      model: model || null,
      permission,
      toolsSettings: { allowedTools: tools.allowedTools ?? [], disallowedTools: tools.disallowedTools ?? [] },
      // Saving a paused one-off task with a new time is how it is rescheduled.
      enabled: task ? task.enabled || kind === 'once' : true,
    };
    setSaving(true);
    setError(null);
    try {
      const response = task ? await api.scheduledTasks.update(task.id, input) : await api.scheduledTasks.create(input);
      if (!response.ok) throw new Error(await readApiError(response));
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSaving(false);
    }
  };

  const toggleDay = (day: number) => {
    setDays((current) => (current.includes(day) ? current.filter((value) => value !== day) : [...current, day]));
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="scheduled-task-editor">
        <DialogTitle>{task ? t('scheduledTasks.editor.editTitle') : t('scheduledTasks.editor.createTitle')}</DialogTitle>
        <form onSubmit={submit}>
          <label>
            <span>{t('scheduledTasks.editor.name')}</span>
            <input value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} placeholder={t('scheduledTasks.editor.namePlaceholder')} />
          </label>
          <label>
            <span>{t('scheduledTasks.editor.project')}</span>
            <select value={projectPath} onChange={(event) => setProjectPath(event.target.value)}>
              <option value={CHAT_WORKSPACE_PATH}>{t('scheduledTasks.editor.chatWorkspace')}</option>
              {projectOptions.map((project) => (
                <option key={project.projectId} value={project.fullPath}>{project.displayName}</option>
              ))}
              {!projectKnown && <option value={projectPath}>{projectPath}</option>}
            </select>
          </label>
          <label>
            <span>{t('scheduledTasks.editor.prompt')}</span>
            <textarea value={prompt} rows={5} required onChange={(event) => setPrompt(event.target.value)} placeholder={t('scheduledTasks.editor.promptPlaceholder')} />
          </label>
          <div className="scheduled-task-editor-row">
            <label>
              <span>{t('scheduledTasks.editor.frequency')}</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as ScheduleKind)}>
                <option value="once">{t('scheduledTasks.editor.kinds.once')}</option>
                <option value="daily">{t('scheduledTasks.editor.kinds.daily')}</option>
                <option value="weekly">{t('scheduledTasks.editor.kinds.weekly')}</option>
                <option value="interval">{t('scheduledTasks.editor.kinds.interval')}</option>
              </select>
            </label>
            {kind === 'once' && (
              <label>
                <span>{t('scheduledTasks.editor.when')}</span>
                <input type="datetime-local" value={onceAt} required onChange={(event) => setOnceAt(event.target.value)} />
              </label>
            )}
            {(kind === 'daily' || kind === 'weekly') && (
              <label>
                <span>{t('scheduledTasks.editor.time')}</span>
                <input type="time" value={time} required onChange={(event) => setTime(event.target.value)} />
              </label>
            )}
            {kind === 'interval' && (
              <label>
                <span>{t('scheduledTasks.editor.hours')}</span>
                <input type="number" min={1} max={168} step={1} value={hours} required onChange={(event) => setHours(Number(event.target.value))} />
              </label>
            )}
          </div>
          {kind === 'weekly' && (
            <div className="scheduled-task-days" role="group" aria-label={t('scheduledTasks.editor.days')}>
              {WEEK_ORDER.map((day) => (
                <button type="button" key={day} aria-pressed={days.includes(day)} onClick={() => toggleDay(day)}>
                  {t(`scheduledTasks.weekdays.${day}`)}
                </button>
              ))}
            </div>
          )}
          <label>
            <span>{t('scheduledTasks.editor.model')}</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="">{t('scheduledTasks.editor.defaultModel')}</option>
              {models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {model && !models.some((option) => option.value === model) && <option value={model}>{model}</option>}
            </select>
          </label>
          <fieldset>
            <legend>{t('scheduledTasks.editor.permission')}</legend>
            <label className="scheduled-task-choice">
              <input type="radio" name="permission" checked={permission === 'edits'} onChange={() => setPermission('edits')} />
              <span>
                <strong>{t('scheduledTasks.permission.edits')}</strong>
                <small>{t('scheduledTasks.permission.editsHint')}</small>
              </span>
            </label>
            <label className="scheduled-task-choice">
              <input type="radio" name="permission" checked={permission === 'all'} onChange={() => setPermission('all')} />
              <span>
                <strong>{t('scheduledTasks.permission.all')}</strong>
                <small>{t('scheduledTasks.permission.allHint')}</small>
              </span>
            </label>
          </fieldset>
          {error && <p role="alert" className="scheduled-task-error">{error}</p>}
          <div className="scheduled-task-editor-actions">
            <button type="button" onClick={onClose}>{t('scheduledTasks.editor.cancel')}</button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? t('scheduledTasks.editor.saving') : t('scheduledTasks.editor.save')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
