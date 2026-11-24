import fs from 'node:fs';
import path from 'node:path';

import { scheduledTasksDb } from '@/modules/database/index.js';
import type {
  ScheduledTaskFields,
  ScheduledTaskPermission,
  ScheduledTaskRow,
  ScheduledTaskRunRow,
} from '@/modules/database/index.js';
import { nextRunAfter, normalizeTimeZone, parseSchedule, readSchedule } from '@/modules/scheduled-tasks/schedule.js';
import type { TaskSchedule } from '@/modules/scheduled-tasks/schedule.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import { AppError, normalizeScheduledTaskPermission } from '@/shared/utils.js';

const MAX_TASKS_PER_USER = 50;
const MAX_NAME_LENGTH = 100;
const MAX_PROMPT_LENGTH = 100_000;
const MAX_TOOL_ENTRIES = 200;

export type ScheduledTaskRun = {
  id: string;
  sessionId: string | null;
  source: ScheduledTaskRunRow['source'];
  status: ScheduledTaskRunRow['status'];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ScheduledTask = {
  id: string;
  name: string;
  projectPath: string;
  prompt: string;
  schedule: TaskSchedule | null;
  timezone: string;
  model: string | null;
  permission: ScheduledTaskPermission;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  runs: ScheduledTaskRun[];
};

/** SQLite's CURRENT_TIMESTAMP has no zone marker; it is UTC. */
const utc = (value: string | null): string | null => {
  if (!value) return null;
  return /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
};

/**
 * Tells every open tab that this user's task list changed: a run started or
 * finished, or a task was added, edited or removed in another tab. The frame
 * carries nothing else; each tab reads the list again through the
 * authenticated GET.
 */
export function announceScheduledTasksChanged(): void {
  const frame = JSON.stringify({ kind: 'scheduled_tasks_changed', timestamp: new Date().toISOString() });
  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;
    try {
      client.send(frame);
    } catch (error) {
      console.error('[ScheduledTasks] Failed to announce a change', { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function toRun(row: ScheduledTaskRunRow): ScheduledTaskRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    source: row.source,
    status: row.status,
    error: row.error,
    startedAt: utc(row.started_at) as string,
    finishedAt: utc(row.finished_at),
  };
}

export function toScheduledTask(row: ScheduledTaskRow, runs: ScheduledTaskRunRow[] = []): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    projectPath: row.project_path,
    prompt: row.prompt,
    schedule: readSchedule(row.schedule),
    timezone: row.timezone,
    model: row.model,
    permission: normalizeScheduledTaskPermission(row.permission),
    enabled: Boolean(row.enabled),
    nextRunAt: utc(row.next_run_at),
    lastRunAt: utc(row.last_run_at),
    createdAt: utc(row.created_at) as string,
    runs: runs.map(toRun),
  };
}

function badRequest(message: string, code = 'INVALID_SCHEDULED_TASK'): never {
  throw new AppError(message, { code, statusCode: 400 });
}

function readText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) badRequest(`${field} is required.`);
  if (value.length > maxLength) badRequest(`${field} must be at most ${maxLength} characters.`);
  return value.trim();
}

function readToolList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0 && entry.length <= 500)
      .slice(0, MAX_TOOL_ENTRIES)
    : [];
}

/**
 * Validates the editable fields a client sent and works out when the task
 * runs next. `existing` keeps the countdown of an interval task whose timing
 * did not change, so renaming it does not push its next run back.
 */
function readFields(body: Record<string, unknown>, now: Date, existing: ScheduledTaskRow | null): ScheduledTaskFields {
  const name = readText(body.name, 'Name', MAX_NAME_LENGTH);
  const prompt = readText(body.prompt, 'Prompt', MAX_PROMPT_LENGTH);
  const projectPath = readText(body.projectPath, 'Project', 4096);
  if (!path.isAbsolute(projectPath)) badRequest('Pick a project folder.');
  try {
    if (!fs.statSync(projectPath).isDirectory()) badRequest('The project folder no longer exists.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    badRequest('The project folder no longer exists.');
  }

  const schedule = parseSchedule(body.schedule, now);
  const timezone = normalizeTimeZone(body.timezone);
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 200) : null;
  const permission: ScheduledTaskPermission = normalizeScheduledTaskPermission(body.permission);
  // Pausing or resuming sends no tool lists; the saved ones are kept then.
  const tools = (body.toolsSettings && typeof body.toolsSettings === 'object' ? body.toolsSettings : null) as Record<string, unknown> | null;
  const toolsSettings = !tools && existing
    ? existing.tools_settings
    : JSON.stringify({
      allowedTools: readToolList(tools?.allowedTools),
      disallowedTools: readToolList(tools?.disallowedTools),
    });
  const enabled = body.enabled !== false;
  const scheduleJson = JSON.stringify(schedule);

  let nextRunAt: Date | null = null;
  if (enabled) {
    const timingUnchanged = existing && existing.enabled && existing.next_run_at
      && existing.schedule === scheduleJson && existing.timezone === timezone;
    nextRunAt = timingUnchanged ? new Date(utc(existing.next_run_at) as string) : nextRunAfter(schedule, timezone, now);
    if (!nextRunAt) badRequest('That time has already passed. Pick a time in the future.', 'SCHEDULE_IN_PAST');
  }

  return { name, prompt, projectPath, schedule: scheduleJson, timezone, model, permission, toolsSettings, enabled, nextRunAt };
}

function notFound(): never {
  throw new AppError('The scheduled task was not found.', { code: 'SCHEDULED_TASK_NOT_FOUND', statusCode: 404 });
}

export const scheduledTasksService = {
  list(userId: number): ScheduledTask[] {
    const runs = scheduledTasksDb.listRunsForUser(userId);
    return scheduledTasksDb.listForUser(userId)
      .map((row) => toScheduledTask(row, runs.filter((run) => run.task_id === row.id)));
  },

  get(userId: number, id: string): ScheduledTask {
    const row = scheduledTasksDb.get(userId, id);
    if (!row) notFound();
    return toScheduledTask(row, scheduledTasksDb.listRunsForUser(userId).filter((run) => run.task_id === id));
  },

  create(userId: number, body: Record<string, unknown>, now: Date = new Date()): ScheduledTask {
    if (scheduledTasksDb.countForUser(userId) >= MAX_TASKS_PER_USER) {
      badRequest(`At most ${MAX_TASKS_PER_USER} scheduled tasks are allowed.`, 'TOO_MANY_SCHEDULED_TASKS');
    }
    const row = scheduledTasksDb.create(userId, readFields(body, now, null));
    announceScheduledTasksChanged();
    return toScheduledTask(row);
  },

  update(userId: number, id: string, body: Record<string, unknown>, now: Date = new Date()): ScheduledTask {
    const existing = scheduledTasksDb.get(userId, id);
    if (!existing) notFound();
    scheduledTasksDb.update(userId, id, readFields(body, now, existing));
    announceScheduledTasksChanged();
    return this.get(userId, id);
  },

  remove(userId: number, id: string): void {
    if (!scheduledTasksDb.remove(userId, id)) notFound();
    announceScheduledTasksChanged();
  },
};
