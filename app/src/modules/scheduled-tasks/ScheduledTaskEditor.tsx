import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock, FastForward, Hand, TriangleAlert, X } from 'lucide-react';

import { api } from '@/shared/api';
import { CHAT_WORKSPACE_PATH, PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { readUserPreference } from '@/shared/userSettings';
import { catalogModelName } from '@/shared/utils';
import type {
  ProviderModelOption,
  ProviderModelsDefinition,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskPermission,
  ScheduledTaskSchedule,
} from '@/shared/types';
import {
  ScheduledTaskMenu,
  ScheduledTaskMenuDivider,
  ScheduledTaskMenuItem,
  ScheduledTaskMenuLabel,
  ScheduledTaskSubmenu,
} from '@/modules/scheduled-tasks/ScheduledTaskMenu';
import ScheduledTaskTimePicker from '@/modules/scheduled-tasks/ScheduledTaskTimePicker';
import { WORKDAYS, isWorkdays } from '@/modules/scheduled-tasks/scheduleText';
import { readApiError } from '@/modules/scheduled-tasks/useScheduledTasks';

/** "At a time" (daily / weekdays / weekly), "every few hours", or "once". */
type TriggerKind = 'schedule' | 'interval' | 'once';
type Frequency = 'daily' | 'weekdays' | 'weekly';

type ScheduledTaskEditorProps = {
  open: boolean;
  /** The task being edited, or null to create one. */
  task: ScheduledTask | null;
  onClose: () => void;
  onSaved: () => void;
  /** "Set up with Claude instead": closes the form and opens a chat that asks for the details. */
  onStartWithClaude: () => void;
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
/** The catalog's own "default" entry is what "Default model" (no model saved) already means. */
const CATALOG_DEFAULT_MODEL = 'default';
/** Claude Code's current-model aliases, listed directly in this order; everything else goes under "More models". */
const PRIMARY_MODEL_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];
/** The prompt box grows with its text up to this height, then scrolls. */
const PROMPT_MAX_HEIGHT = 240;

/**
 * Splits the Claude catalog the way the chat composer's model menu does: the
 * four family aliases first, then older versions and custom models. 1M-context
 * aliases are left out because they share a model with their family alias.
 */
function splitModelCatalog(options: ProviderModelOption[]) {
  const models = options.filter((option) => option.value !== CATALOG_DEFAULT_MODEL && !/\[1m\]/i.test(option.value));
  const families = PRIMARY_MODEL_FAMILIES
    .map((family) => models.find((option) => option.value === family))
    .filter((option): option is ProviderModelOption => Boolean(option));
  // A catalog without the family aliases (only custom models, say) still gets a main list.
  const primary = families.length ? families : models.slice(0, PRIMARY_MODEL_FAMILIES.length);
  return { primary, more: models.filter((option) => !primary.includes(option)) };
}

/** The name a model is shown by: "Opus 5.5" rather than the bare alias label "Opus". */
const modelName = (option: ProviderModelOption) => catalogModelName(option) || option.value;

const PERMISSION_ICONS: Record<ScheduledTaskPermission, ReactNode> = {
  manual: <Hand size={16} />,
  edits: <FastForward size={16} />,
  all: <TriangleAlert size={16} />,
};
const PERMISSION_ORDER: ScheduledTaskPermission[] = ['manual', 'edits', 'all'];

/** Rendered by ScheduledTasksPage to create or edit one task. */
export default function ScheduledTaskEditor({ open, task, onClose, onSaved, onStartWithClaude }: ScheduledTaskEditorProps) {
  const { t } = useTranslation('sidebar');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  // The trigger menu's choice; together with frequency it decides which schedule is saved.
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('schedule');
  // Daily, Monday-Friday, or chosen weekdays, for the "at a time" trigger.
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [time, setTime] = useState('09:00');
  const [days, setDays] = useState<number[]>([1]);
  const [hours, setHours] = useState(6);
  const [onceAt, setOnceAt] = useState(inAnHour);
  const [model, setModel] = useState('');
  const [permission, setPermission] = useState<ScheduledTaskPermission>('edits');
  // The Claude model catalog, read when the form opens; empty until then or if the request fails.
  const [models, setModels] = useState<ProviderModelOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The expanded safety notes under the permission notice.
  const [showSafety, setShowSafety] = useState(false);

  // The form starts from the task (or blank) each time it opens.
  useEffect(() => {
    if (!open) return;
    const schedule = task?.schedule;
    setName(task?.name ?? '');
    setPrompt(task?.prompt ?? '');
    setTriggerKind(schedule?.kind === 'interval' ? 'interval' : schedule?.kind === 'once' ? 'once' : 'schedule');
    setFrequency(schedule?.kind === 'weekly' ? (isWorkdays(schedule.days) ? 'weekdays' : 'weekly') : 'daily');
    setTime(schedule && 'time' in schedule ? schedule.time : '09:00');
    setDays(schedule?.kind === 'weekly' ? schedule.days : [1]);
    setHours(schedule?.kind === 'interval' ? schedule.hours : 6);
    setOnceAt(schedule?.kind === 'once' ? toLocalInput(new Date(schedule.at)) : inAnHour());
    setModel(task?.model ?? '');
    setPermission(task?.permission ?? 'edits');
    setShowSafety(false);
    setError(null);
    setSaving(false);
  }, [open, task]);

  // The model catalog is read when the form opens; it is not needed before.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await api.providers.models('claude');
        // GET /api/providers/claude/models answers { success, data: { provider, models: { OPTIONS, DEFAULT } } }.
        const body = response.ok ? await response.json() as { data?: { models?: ProviderModelsDefinition } } : null;
        const options = body?.data?.models?.OPTIONS;
        if (!cancelled) setModels(Array.isArray(options) ? options : []);
      } catch {
        // The form still works with the default model.
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // The prompt box follows its text instead of offering a resize handle.
  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
    textarea.style.overflowY = textarea.scrollHeight > PROMPT_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [prompt, open]);

  const { primary: primaryModels, more: moreModels } = splitModelCatalog(models);
  const catalog = [...primaryModels, ...moreModels];
  // A saved model the catalog no longer lists stays selectable instead of silently changing.
  const unlistedModel = model && !catalog.some((option) => option.value === model) ? model : null;
  const selectedModel = catalog.find((option) => option.value === model);
  const modelLabel = model ? (selectedModel ? modelName(selectedModel) : model) : t('scheduledTasks.editor.defaultModel');

  const buildSchedule = (): ScheduledTaskSchedule => {
    if (triggerKind === 'once') return { kind: 'once', at: new Date(onceAt).toISOString() };
    if (triggerKind === 'interval') return { kind: 'interval', hours };
    if (frequency === 'weekdays') return { kind: 'weekly', time, days: WORKDAYS };
    if (frequency === 'weekly') return { kind: 'weekly', time, days };
    return { kind: 'daily', time };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (triggerKind === 'once' && Number.isNaN(new Date(onceAt).getTime())) {
      setError(t('scheduledTasks.editor.pickDate'));
      return;
    }
    if (triggerKind === 'schedule' && frequency === 'weekly' && days.length === 0) {
      setError(t('scheduledTasks.editor.pickDays'));
      return;
    }
    const tools = readUserPreference<{ allowedTools?: string[]; disallowedTools?: string[] }>(
      PROVIDER_PERMISSION_PREFERENCE_KEYS.claude,
      { allowedTools: [], disallowedTools: [] },
    );
    const input: ScheduledTaskInput = {
      name: name.trim(),
      // New tasks run in the chat workspace; an existing task keeps the folder it was created with.
      projectPath: task?.projectPath ?? CHAT_WORKSPACE_PATH,
      prompt,
      schedule: buildSchedule(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      model: model || null,
      permission,
      toolsSettings: { allowedTools: tools.allowedTools ?? [], disallowedTools: tools.disallowedTools ?? [] },
      // Saving a paused one-off task with a new time is how it is rescheduled.
      enabled: task ? task.enabled || triggerKind === 'once' : true,
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

  const chevron = <ChevronDown size={14} className="scheduled-task-chevron" aria-hidden="true" />;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="scheduled-task-editor">
        <div className="scheduled-task-editor-head">
          <DialogTitle className="scheduled-task-editor-title not-sr-only">
            {task ? t('scheduledTasks.editor.editTitle') : t('scheduledTasks.editor.createTitle')}
          </DialogTitle>
          <button type="button" className="scheduled-task-editor-close" aria-label={t('scheduledTasks.editor.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {!task && (
          <button type="button" className="scheduled-task-editor-switch" onClick={onStartWithClaude}>
            {t('scheduledTasks.editor.useClaude')}
          </button>
        )}
        <form onSubmit={submit}>
          <div className="scheduled-task-editor-body">
            <label className="scheduled-task-field">
              <span>{t('scheduledTasks.editor.name')}</span>
              <input value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} placeholder={t('scheduledTasks.editor.namePlaceholder')} />
            </label>

            <div className="scheduled-task-field">
              <label htmlFor="scheduled-task-prompt">{t('scheduledTasks.editor.prompt')}</label>
              <div className="scheduled-task-prompt-box">
                <textarea ref={promptRef} id="scheduled-task-prompt" value={prompt} rows={3} required onChange={(event) => setPrompt(event.target.value)} placeholder={t('scheduledTasks.editor.promptPlaceholder')} />
                <div className="scheduled-task-prompt-bar">
                  <ScheduledTaskMenu
                    triggerClassName="scheduled-task-chip"
                    ariaLabel={t('scheduledTasks.editor.permission')}
                    trigger={<>{PERMISSION_ICONS[permission]}<span>{t(`scheduledTasks.permission.${permission}`)}</span>{chevron}</>}
                    panelClassName="scheduled-task-menu-wide"
                  >
                    {(close) => (
                      <>
                        <ScheduledTaskMenuLabel>{t('scheduledTasks.editor.permission')}</ScheduledTaskMenuLabel>
                        {PERMISSION_ORDER.map((value) => (
                          <ScheduledTaskMenuItem
                            key={value}
                            icon={PERMISSION_ICONS[value]}
                            label={t(`scheduledTasks.permission.${value}`)}
                            description={t(`scheduledTasks.permission.${value}Hint`)}
                            selected={permission === value}
                            danger={value === 'all'}
                            onSelect={() => { setPermission(value); close(); }}
                          />
                        ))}
                      </>
                    )}
                  </ScheduledTaskMenu>
                  <ScheduledTaskMenu
                    triggerClassName="scheduled-task-chip"
                    ariaLabel={t('scheduledTasks.editor.model')}
                    align="end"
                    trigger={<><span>{modelLabel}</span>{chevron}</>}
                  >
                    {(close) => (
                      <>
                        <ScheduledTaskMenuItem label={t('scheduledTasks.editor.defaultModel')} selected={!model} onSelect={() => { setModel(''); close(); }} />
                        {primaryModels.map((option) => (
                          <ScheduledTaskMenuItem key={option.value} label={modelName(option)} selected={model === option.value} onSelect={() => { setModel(option.value); close(); }} />
                        ))}
                        {unlistedModel && (
                          <ScheduledTaskMenuItem label={unlistedModel} selected onSelect={close} />
                        )}
                        {moreModels.length > 0 && (
                          <>
                            <ScheduledTaskMenuDivider />
                            <ScheduledTaskSubmenu label={t('scheduledTasks.editor.moreModels')}>
                              {moreModels.map((option) => (
                                <ScheduledTaskMenuItem key={option.value} label={modelName(option)} selected={model === option.value} onSelect={() => { setModel(option.value); close(); }} />
                              ))}
                            </ScheduledTaskSubmenu>
                          </>
                        )}
                      </>
                    )}
                  </ScheduledTaskMenu>
                </div>
              </div>
            </div>

            <div className={`scheduled-task-notice ${permission === 'all' ? 'danger' : ''}`}>
              <p>
                {t(`scheduledTasks.editor.notice.${permission}`)}{' '}
                <button type="button" className="scheduled-task-link" aria-expanded={showSafety} onClick={() => setShowSafety((value) => !value)}>
                  {t('scheduledTasks.editor.safetyLink')}
                </button>
              </p>
              {showSafety && <p className="scheduled-task-notice-detail">{t('scheduledTasks.editor.safetyTips')}</p>}
            </div>

            <div className="scheduled-task-trigger">
              <span className="scheduled-task-trigger-label">{t('scheduledTasks.editor.trigger')}</span>
              <div className="scheduled-task-trigger-controls">
                <ScheduledTaskMenu
                  triggerClassName="scheduled-task-chip"
                  ariaLabel={t('scheduledTasks.editor.trigger')}
                  trigger={<><Clock size={15} /><span>{t(`scheduledTasks.editor.triggerKinds.${triggerKind}`)}</span>{chevron}</>}
                >
                  {(close) => (['schedule', 'interval', 'once'] as TriggerKind[]).map((value) => (
                    <ScheduledTaskMenuItem key={value} label={t(`scheduledTasks.editor.triggerKinds.${value}`)} selected={triggerKind === value}
                      onSelect={() => { setTriggerKind(value); close(); }} />
                  ))}
                </ScheduledTaskMenu>
                {triggerKind === 'schedule' && (
                  <>
                    <ScheduledTaskMenu
                      triggerClassName="scheduled-task-chip"
                      ariaLabel={t('scheduledTasks.editor.frequency')}
                      trigger={<><span>{t(`scheduledTasks.editor.frequencies.${frequency}`)}</span>{chevron}</>}
                    >
                      {(close) => (['daily', 'weekdays', 'weekly'] as Frequency[]).map((value) => (
                        <ScheduledTaskMenuItem key={value} label={t(`scheduledTasks.editor.frequencies.${value}`)} selected={frequency === value}
                          onSelect={() => { setFrequency(value); close(); }} />
                      ))}
                    </ScheduledTaskMenu>
                    <ScheduledTaskTimePicker value={time} onChange={setTime} ariaLabel={t('scheduledTasks.editor.time')}
                      hourLabel={t('scheduledTasks.editor.hour')} minuteLabel={t('scheduledTasks.editor.minute')} />
                  </>
                )}
                {triggerKind === 'interval' && (
                  <label className="scheduled-task-chip scheduled-task-hours">
                    <span>{t('scheduledTasks.editor.hoursPrefix')}</span>
                    <input type="number" min={1} max={168} step={1} aria-label={t('scheduledTasks.editor.hours')} value={hours} required onChange={(event) => setHours(Number(event.target.value))} />
                    <span>{t('scheduledTasks.editor.hoursSuffix')}</span>
                  </label>
                )}
                {triggerKind === 'once' && (
                  <>
                    <input type="date" className="scheduled-task-chip scheduled-task-time" aria-label={t('scheduledTasks.editor.date')} value={onceAt.slice(0, 10)} required
                      onChange={(event) => setOnceAt(`${event.target.value}T${onceAt.slice(11, 16)}`)} />
                    <ScheduledTaskTimePicker value={onceAt.slice(11, 16)} onChange={(next) => setOnceAt(`${onceAt.slice(0, 10)}T${next}`)}
                      ariaLabel={t('scheduledTasks.editor.time')} hourLabel={t('scheduledTasks.editor.hour')} minuteLabel={t('scheduledTasks.editor.minute')} />
                  </>
                )}
              </div>
            </div>
            {triggerKind === 'schedule' && frequency === 'weekly' && (
              <div className="scheduled-task-days" role="group" aria-label={t('scheduledTasks.editor.days')}>
                {WEEK_ORDER.map((day) => (
                  <button type="button" key={day} aria-pressed={days.includes(day)} onClick={() => toggleDay(day)}>
                    {t(`scheduledTasks.weekdays.${day}`)}
                  </button>
                ))}
              </div>
            )}
            {error && <p role="alert" className="scheduled-task-error">{error}</p>}
          </div>
          <div className="scheduled-task-editor-actions">
            <button type="button" onClick={onClose}>{t('scheduledTasks.editor.cancel')}</button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? t('scheduledTasks.editor.saving') : task ? t('scheduledTasks.editor.save') : t('scheduledTasks.editor.create')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
