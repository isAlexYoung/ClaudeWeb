import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';
import type { ScheduledTaskPermission } from '@/shared/types.js';

// Re-exported so existing consumers of the database barrel keep one import site.
export type { ScheduledTaskPermission };
export type ScheduledTaskRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ScheduledTaskRunTrigger = 'schedule' | 'manual';

export type ScheduledTaskRow = {
  id: string;
  user_id: number;
  name: string;
  project_path: string;
  prompt: string;
  schedule: string;
  timezone: string;
  model: string | null;
  permission: ScheduledTaskPermission;
  tools_settings: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduledTaskRunRow = {
  id: string;
  task_id: string;
  session_id: string | null;
  source: ScheduledTaskRunTrigger;
  status: ScheduledTaskRunStatus;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

/** The editable fields of a task, already validated by the service. */
export type ScheduledTaskFields = {
  name: string;
  projectPath: string;
  prompt: string;
  schedule: string;
  timezone: string;
  model: string | null;
  permission: ScheduledTaskPermission;
  toolsSettings: string;
  enabled: boolean;
  nextRunAt: Date | null;
};

const TASK_COLUMNS = 'id, user_id, name, project_path, prompt, schedule, timezone, model, permission, '
  + 'tools_settings, enabled, next_run_at, last_run_at, created_at, updated_at';
const RUN_COLUMNS = 'id, task_id, session_id, source, status, error, started_at, finished_at';

/** Runs kept per task; older ones are dropped when a new one is recorded. */
export const RUNS_KEPT_PER_TASK = 20;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export const scheduledTasksDb = {
  create(userId: number, fields: ScheduledTaskFields): ScheduledTaskRow {
    const db = getConnection();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO scheduled_tasks (id, user_id, name, project_path, prompt, schedule, timezone, model,
         permission, tools_settings, enabled, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, fields.name, fields.projectPath, fields.prompt, fields.schedule, fields.timezone,
      fields.model, fields.permission, fields.toolsSettings, fields.enabled ? 1 : 0, iso(fields.nextRunAt));
    return this.get(userId, id) as ScheduledTaskRow;
  },

  update(userId: number, id: string, fields: ScheduledTaskFields): ScheduledTaskRow | null {
    getConnection().prepare(
      `UPDATE scheduled_tasks
       SET name = ?, project_path = ?, prompt = ?, schedule = ?, timezone = ?, model = ?, permission = ?,
           tools_settings = ?, enabled = ?, next_run_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).run(fields.name, fields.projectPath, fields.prompt, fields.schedule, fields.timezone, fields.model,
      fields.permission, fields.toolsSettings, fields.enabled ? 1 : 0, iso(fields.nextRunAt), id, userId);
    return this.get(userId, id);
  },

  get(userId: number, id: string): ScheduledTaskRow | null {
    return (getConnection()
      .prepare(`SELECT ${TASK_COLUMNS} FROM scheduled_tasks WHERE id = ? AND user_id = ?`)
      .get(id, userId) as ScheduledTaskRow | undefined) ?? null;
  },

  getById(id: string): ScheduledTaskRow | null {
    return (getConnection()
      .prepare(`SELECT ${TASK_COLUMNS} FROM scheduled_tasks WHERE id = ?`)
      .get(id) as ScheduledTaskRow | undefined) ?? null;
  },

  listForUser(userId: number): ScheduledTaskRow[] {
    return getConnection()
      .prepare(`SELECT ${TASK_COLUMNS} FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at ASC, id ASC`)
      .all(userId) as ScheduledTaskRow[];
  },

  countForUser(userId: number): number {
    const row = getConnection()
      .prepare('SELECT COUNT(*) AS count FROM scheduled_tasks WHERE user_id = ?')
      .get(userId) as { count: number };
    return row.count;
  },

  /** Deletes the task and its run history; the conversations it started stay. */
  remove(userId: number, id: string): boolean {
    const db = getConnection();
    return db.transaction(() => {
      const removed = db.prepare('DELETE FROM scheduled_tasks WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
      if (removed) db.prepare('DELETE FROM scheduled_task_runs WHERE task_id = ?').run(id);
      return removed;
    })();
  },

  /**
   * Claims every enabled task whose time has come and moves it to its next
   * time in the same transaction, so two overlapping polls cannot claim the
   * same occurrence. `nextAfter` gives the following occurrence (null for a
   * one-off task, which is then switched off).
   */
  claimDue(now: Date, nextAfter: (row: ScheduledTaskRow) => Date | null): ScheduledTaskRow[] {
    const db = getConnection();
    return db.transaction(() => {
      const due = db.prepare(
        `SELECT ${TASK_COLUMNS} FROM scheduled_tasks
         WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      ).all(now.toISOString()) as ScheduledTaskRow[];
      for (const row of due) {
        const next = nextAfter(row);
        db.prepare(
          `UPDATE scheduled_tasks
           SET next_run_at = ?, enabled = ?, last_run_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(iso(next), next ? 1 : 0, now.toISOString(), row.id);
      }
      return due;
    })();
  },

  markManualRun(id: string, now: Date): void {
    getConnection()
      .prepare('UPDATE scheduled_tasks SET last_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(now.toISOString(), id);
  },

  createRun(taskId: string, source: ScheduledTaskRunTrigger, now: Date): ScheduledTaskRunRow {
    const db = getConnection();
    const id = randomUUID();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO scheduled_task_runs (id, task_id, source, status, started_at) VALUES (?, ?, ?, 'queued', ?)`,
      ).run(id, taskId, source, now.toISOString());
      db.prepare(
        `DELETE FROM scheduled_task_runs WHERE task_id = ? AND id NOT IN (
           SELECT id FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?)`,
      ).run(taskId, taskId, RUNS_KEPT_PER_TASK);
    })();
    return db.prepare(`SELECT ${RUN_COLUMNS} FROM scheduled_task_runs WHERE id = ?`).get(id) as ScheduledTaskRunRow;
  },

  startRun(runId: string, sessionId: string, now: Date): void {
    getConnection()
      .prepare(`UPDATE scheduled_task_runs SET status = 'running', session_id = ?, started_at = ? WHERE id = ?`)
      .run(sessionId, now.toISOString(), runId);
  },

  finishRun(runId: string, error: string | null, now: Date): void {
    getConnection()
      .prepare(`UPDATE scheduled_task_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?`)
      .run(error ? 'failed' : 'succeeded', error ? error.slice(0, 500) : null, now.toISOString(), runId);
  },

  hasActiveRun(taskId: string): boolean {
    return Boolean(getConnection()
      .prepare(`SELECT 1 FROM scheduled_task_runs WHERE task_id = ? AND status IN ('queued', 'running') LIMIT 1`)
      .get(taskId));
  },

  /** Runs left queued or running by a server that stopped; they will never finish. */
  failInterruptedRuns(reason: string, now: Date): number {
    return getConnection()
      .prepare(
        `UPDATE scheduled_task_runs SET status = 'failed', error = ?, finished_at = ?
         WHERE status IN ('queued', 'running')`,
      )
      .run(reason, now.toISOString()).changes;
  },

  listRunsForUser(userId: number): ScheduledTaskRunRow[] {
    return getConnection()
      .prepare(
        `SELECT ${RUN_COLUMNS.split(', ').map((column) => `r.${column}`).join(', ')}
         FROM scheduled_task_runs r JOIN scheduled_tasks t ON t.id = r.task_id
         WHERE t.user_id = ?
         ORDER BY r.started_at DESC, r.rowid DESC`,
      )
      .all(userId) as ScheduledTaskRunRow[];
  },
};
