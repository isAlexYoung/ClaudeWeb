import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { getConnection } from '@/modules/database/connection.js';
import type {
  BackupArtefactRecord,
  BackupDatabaseSnapshot,
  BackupMergeResult,
  BackupMergeSelection,
  BackupSessionRecord,
} from '@/shared/types.js';
import { normalizeProjectPath, normalizeScheduledTaskPermission } from '@/shared/utils.js';

/**
 * Failure reason stored on a pending scheduled message whose time had already
 * passed when a backup was restored. The composer shows a translated text for
 * this code instead of sending a message hours or days late.
 */
const RESTORED_OVERDUE_REASON = 'BACKUP_RESTORED_OVERDUE';

const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function parseStoredTimestamp(value: string): number {
  const normalized = SQLITE_UTC_TIMESTAMP_REGEX.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  return new Date(normalized).getTime();
}

type ProjectRow = {
  project_id: string;
  project_path: string;
  custom_project_name: string | null;
  isStarred: number;
  isArchived: number;
};

type SessionRow = {
  session_id: string;
  provider_session_id: string;
  project_path: string | null;
  custom_name: string | null;
  model: string | null;
  effort: string | null;
  forked_from_session_id: string | null;
  isArchived: number;
  created_at: string | null;
  updated_at: string | null;
};

const IN_CLAUSE_CHUNK = 500;

export const backupDb = {
  /**
   * Reads one user's ClaudeWeb rows for a backup. Only Claude sessions that
   * already have a transcript id are included: a session that never ran has
   * nothing to resume.
   */
  exportSnapshot(userId: number): BackupDatabaseSnapshot {
    const db = getConnection();
    const projects = db.prepare(
      `SELECT project_id, project_path, custom_project_name, isStarred, isArchived FROM projects ORDER BY project_path`
    ).all() as ProjectRow[];
    const sessions = db.prepare(
      `SELECT session_id, provider_session_id, project_path, custom_name, model, effort, forked_from_session_id,
              isArchived, created_at, updated_at
       FROM sessions
       WHERE provider = 'claude' AND provider_session_id IS NOT NULL
       ORDER BY session_id`
    ).all() as SessionRow[];
    const preferences = db.prepare(
      `SELECT preference_key, preference_value FROM user_preferences WHERE user_id = ? ORDER BY preference_key`
    ).all(userId) as Array<{ preference_key: string; preference_value: string }>;
    const drafts = db.prepare(
      `SELECT draft_scope, draft_text, queued_message, updated_at FROM session_drafts WHERE user_id = ? ORDER BY draft_scope`
    ).all(userId) as Array<{ draft_scope: string; draft_text: string; queued_message: string | null; updated_at: string | null }>;
    const scheduledMessages = db.prepare(
      `SELECT id, session_id, content, options, scheduled_for, status, failure_reason, created_at, updated_at
       FROM scheduled_messages WHERE user_id = ? ORDER BY id`
    ).all(userId) as Array<{
      id: string; session_id: string; content: string; options: string; scheduled_for: string;
      status: string; failure_reason: string | null; created_at: string | null; updated_at: string | null;
    }>;
    const scheduledTasks = db.prepare(
      `SELECT id, name, project_path, prompt, schedule, timezone, model, permission, tools_settings, created_at
       FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at, id`
    ).all(userId) as Array<{
      id: string; name: string; project_path: string; prompt: string; schedule: string; timezone: string;
      model: string | null; permission: string; tools_settings: string; created_at: string | null;
    }>;
    const providerModels = db.prepare(
      `SELECT model_id, model_name, sort_order, effort_values, effort_default
       FROM provider_models WHERE provider = 'claude' ORDER BY sort_order, id`
    ).all() as Array<{ model_id: string; model_name: string; sort_order: number; effort_values: string | null; effort_default: string | null }>;
    const uploadedFiles = db.prepare(
      `SELECT stored_name, original_name, mime_type, size, project_path, session_id, created_at
       FROM uploaded_files ORDER BY stored_name`
    ).all() as Array<{
      stored_name: string; original_name: string; mime_type: string | null; size: number;
      project_path: string | null; session_id: string | null; created_at: string | null;
    }>;

    const artefacts = db.prepare(
      `SELECT id, kind, title, file_path, session_id, pinned, created_at, updated_at, opened_at
       FROM artefacts WHERE user_id = ? ORDER BY created_at, id`
    ).all(userId) as Array<{
      id: string; kind: BackupArtefactRecord['kind']; title: string; file_path: string; session_id: string | null;
      pinned: number; created_at: string | null; updated_at: string | null; opened_at: string | null;
    }>;

    return {
      version: 1,
      projects: projects.map((row) => ({
        projectId: row.project_id,
        projectPath: row.project_path,
        customProjectName: row.custom_project_name,
        isStarred: Boolean(row.isStarred),
        isArchived: Boolean(row.isArchived),
      })),
      sessions: sessions.map((row) => ({
        sessionId: row.session_id,
        providerSessionId: row.provider_session_id,
        projectPath: row.project_path,
        customName: row.custom_name,
        model: row.model,
        effort: row.effort,
        forkedFromSessionId: row.forked_from_session_id,
        isArchived: Boolean(row.isArchived),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      preferences: preferences.map((row) => ({ key: row.preference_key, value: row.preference_value })),
      drafts: drafts.map((row) => ({
        scope: row.draft_scope,
        text: row.draft_text,
        queuedMessage: row.queued_message,
        updatedAt: row.updated_at,
      })),
      scheduledMessages: scheduledMessages.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        content: row.content,
        options: row.options,
        scheduledFor: row.scheduled_for,
        status: row.status,
        failureReason: row.failure_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      scheduledTasks: scheduledTasks.map((row) => ({
        id: row.id,
        name: row.name,
        projectPath: row.project_path,
        prompt: row.prompt,
        schedule: row.schedule,
        timezone: row.timezone,
        model: row.model,
        permission: normalizeScheduledTaskPermission(row.permission),
        toolsSettings: row.tools_settings,
        createdAt: row.created_at,
      })),
      providerModels: providerModels.map((row) => ({
        modelId: row.model_id,
        modelName: row.model_name,
        sortOrder: row.sort_order,
        effortValues: row.effort_values,
        effortDefault: row.effort_default,
      })),
      uploadedFiles: uploadedFiles.map((row) => ({
        storedName: row.stored_name,
        originalName: row.original_name,
        mimeType: row.mime_type,
        size: row.size,
        projectPath: row.project_path,
        sessionId: row.session_id,
        createdAt: row.created_at,
      })),
      artefacts: artefacts.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        fileName: path.basename(row.file_path),
        sessionId: row.session_id,
        pinned: row.pinned === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        openedAt: row.opened_at,
      })),
    };
  },

  /** The subset of the given artefact ids this database already holds (for any account). */
  findKnownArtefactIds(ids: string[]): Set<string> {
    const db = getConnection();
    const known = new Set<string>();
    for (let start = 0; start < ids.length; start += IN_CLAUSE_CHUNK) {
      const chunk = ids.slice(start, start + IN_CLAUSE_CHUNK);
      const rows = db.prepare(`SELECT id FROM artefacts WHERE id IN (${chunk.map(() => '?').join(', ')})`).all(...chunk) as Array<{ id: string }>;
      for (const row of rows) known.add(row.id);
    }
    return known;
  },

  /** The subset of the given provider session ids this database already indexes. */
  findKnownProviderSessionIds(providerSessionIds: string[]): Set<string> {
    const db = getConnection();
    const known = new Set<string>();
    for (let start = 0; start < providerSessionIds.length; start += IN_CLAUSE_CHUNK) {
      const chunk = providerSessionIds.slice(start, start + IN_CLAUSE_CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT provider_session_id AS id FROM sessions WHERE provider_session_id IN (${placeholders})
         UNION SELECT session_id AS id FROM sessions WHERE session_id IN (${placeholders})`
      ).all(...chunk, ...chunk) as Array<{ id: string }>;
      for (const row of rows) known.add(row.id);
    }
    return known;
  },

  /**
   * Merges a backup's rows into this database in one transaction, never
   * replacing what the current installation already has:
   *
   * - projects: missing ones are added; an existing one only takes the backup's
   *   name, star and archive flag where it still has the defaults;
   * - sessions: only those whose transcript this import wrote. A row the
   *   watcher may already have created for the transcript (keyed by the
   *   provider id) is replaced by the backup's app row so the sidebar shows
   *   one entry;
   * - preferences, drafts, scheduled messages, custom models: added only where
   *   the key is still free. Pending scheduled messages that are already due
   *   are stored as failed instead of being sent late.
   */
  mergeSnapshot(snapshot: BackupDatabaseSnapshot, selection: BackupMergeSelection): BackupMergeResult {
    const db = getConnection();
    const result: BackupMergeResult = {
      projects: 0,
      sessions: 0,
      preferences: 0,
      drafts: 0,
      scheduledMessages: 0,
      overdueScheduledMessages: 0,
      scheduledTasks: 0,
      providerModels: 0,
      uploadedFiles: 0,
      artefacts: 0,
    };

    const restoredSessions = snapshot.sessions.filter((session) => selection.restoredSessions.has(session.providerSessionId));
    const restoredAppSessionIds = new Set(restoredSessions.map((session) => session.sessionId));

    const neededProjectPaths = new Set<string>();
    for (const projectPath of selection.projectPaths) neededProjectPaths.add(normalizeProjectPath(projectPath));
    for (const session of restoredSessions) {
      if (session.projectPath) neededProjectPaths.add(normalizeProjectPath(session.projectPath));
    }

    const selectProject = db.prepare(
      `SELECT project_id, project_path, custom_project_name, isStarred, isArchived FROM projects WHERE project_path = ?`
    );
    const projectIdTaken = db.prepare(`SELECT 1 FROM projects WHERE project_id = ?`);
    const insertProject = db.prepare(
      `INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, ?, ?, ?)`
    );
    const fillProject = db.prepare(
      `UPDATE projects SET
         custom_project_name = CASE WHEN custom_project_name IS NULL OR custom_project_name = ? THEN ? ELSE custom_project_name END,
         isStarred = CASE WHEN isStarred = 0 THEN ? ELSE isStarred END,
         isArchived = CASE WHEN isArchived = 0 THEN ? ELSE isArchived END
       WHERE project_id = ?`
    );
    const removeWatcherDuplicate = db.prepare(
      `DELETE FROM sessions WHERE (session_id = ? OR provider_session_id = ?) AND session_id <> ?`
    );
    const upsertSession = db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, model, effort,
                             forked_from_session_id, isArchived, created_at, updated_at)
       VALUES (?, 'claude', ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(session_id) DO UPDATE SET
         provider_session_id = excluded.provider_session_id,
         custom_name = COALESCE(excluded.custom_name, sessions.custom_name),
         project_path = excluded.project_path,
         jsonl_path = excluded.jsonl_path,
         model = COALESCE(excluded.model, sessions.model),
         effort = COALESCE(excluded.effort, sessions.effort),
         forked_from_session_id = COALESCE(excluded.forked_from_session_id, sessions.forked_from_session_id),
         isArchived = excluded.isArchived,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    );
    const insertPreference = db.prepare(
      `INSERT INTO user_preferences (user_id, preference_key, preference_value, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id, preference_key) DO NOTHING`
    );
    const insertDraft = db.prepare(
      `INSERT INTO session_drafts (user_id, draft_scope, draft_text, queued_message, updated_at)
       VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP)) ON CONFLICT(user_id, draft_scope) DO NOTHING`
    );
    const insertScheduled = db.prepare(
      `INSERT INTO scheduled_messages (id, user_id, session_id, content, options, scheduled_for, status, failure_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(id) DO NOTHING`
    );
    // Restored paused (enabled = 0, no next run): a task should not fire on a
    // new machine before the user has checked its project still exists there.
    const insertTask = db.prepare(
      `INSERT INTO scheduled_tasks (id, user_id, name, project_path, prompt, schedule, timezone, model, permission,
                                    tools_settings, enabled, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(id) DO NOTHING`
    );
    const insertModel = db.prepare(
      `INSERT INTO provider_models (provider, model_id, model_name, sort_order, effort_values, effort_default)
       VALUES ('claude', ?, ?, ?, ?, ?) ON CONFLICT(provider, model_id) DO NOTHING`
    );
    const insertUploadedFile = db.prepare(
      `INSERT INTO uploaded_files (stored_name, original_name, mime_type, size, project_path, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP)) ON CONFLICT(stored_name) DO NOTHING`
    );
    const insertArtefact = db.prepare(
      `INSERT INTO artefacts (id, user_id, kind, title, file_path, session_id, pinned, created_at, updated_at, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
    );
    const sessionExists = db.prepare(`SELECT 1 FROM sessions WHERE session_id = ?`);

    db.transaction(() => {
      // Old project id -> id in this database, for drafts scoped to a project.
      const projectIds = new Map<string, string>();
      const backupProjects = new Map(snapshot.projects.map((project) => [normalizeProjectPath(project.projectPath), project]));

      for (const projectPath of neededProjectPaths) {
        if (!projectPath) continue;
        const backup = backupProjects.get(projectPath);
        const defaultName = path.basename(projectPath) || projectPath;
        const existing = selectProject.get(projectPath) as ProjectRow | undefined;
        if (existing) {
          if (backup) {
            fillProject.run(
              defaultName,
              backup.customProjectName ?? existing.custom_project_name,
              backup.isStarred ? 1 : 0,
              backup.isArchived ? 1 : 0,
              existing.project_id,
            );
            projectIds.set(backup.projectId, existing.project_id);
          }
          continue;
        }

        const projectId = backup && !projectIdTaken.get(backup.projectId) ? backup.projectId : randomUUID();
        insertProject.run(
          projectId,
          projectPath,
          backup?.customProjectName ?? defaultName,
          backup?.isStarred ? 1 : 0,
          backup?.isArchived ? 1 : 0,
        );
        if (backup) projectIds.set(backup.projectId, projectId);
        result.projects += 1;
      }

      for (const session of restoredSessions) {
        const jsonlPath = selection.restoredSessions.get(session.providerSessionId) ?? null;
        removeWatcherDuplicate.run(session.providerSessionId, session.providerSessionId, session.sessionId);
        upsertSession.run(
          session.sessionId,
          session.providerSessionId,
          session.customName,
          session.projectPath ? normalizeProjectPath(session.projectPath) : null,
          jsonlPath,
          session.model,
          session.effort,
          session.forkedFromSessionId,
          session.isArchived ? 1 : 0,
          session.createdAt,
          session.updatedAt,
        );
        result.sessions += 1;
      }

      for (const preference of snapshot.preferences) {
        result.preferences += insertPreference.run(selection.userId, preference.key, preference.value).changes;
      }

      for (const draft of snapshot.drafts) {
        let scope: string | null = null;
        if (draft.scope.startsWith('project:')) {
          const mapped = projectIds.get(draft.scope.slice('project:'.length));
          scope = mapped ? `project:${mapped}` : null;
        } else if (restoredAppSessionIds.has(draft.scope)) {
          scope = draft.scope;
        }
        if (!scope) continue;
        result.drafts += insertDraft.run(selection.userId, scope, draft.text, draft.queuedMessage, draft.updatedAt).changes;
      }

      const now = selection.now.getTime();
      for (const message of snapshot.scheduledMessages) {
        if (!restoredAppSessionIds.has(message.sessionId)) continue;
        const overdue = message.status === 'pending' && !(parseStoredTimestamp(message.scheduledFor) > now);
        const changes = insertScheduled.run(
          message.id,
          selection.userId,
          message.sessionId,
          message.content,
          message.options,
          message.scheduledFor,
          overdue ? 'failed' : message.status,
          overdue ? RESTORED_OVERDUE_REASON : message.failureReason,
          message.createdAt,
          message.updatedAt,
        ).changes;
        result.scheduledMessages += changes;
        if (overdue) result.overdueScheduledMessages += changes;
      }

      for (const task of snapshot.scheduledTasks) {
        result.scheduledTasks += insertTask.run(
          task.id,
          selection.userId,
          task.name,
          normalizeProjectPath(task.projectPath),
          task.prompt,
          task.schedule,
          task.timezone,
          task.model,
          task.permission,
          task.toolsSettings,
          task.createdAt,
        ).changes;
      }

      for (const model of snapshot.providerModels) {
        result.providerModels += insertModel.run(
          model.modelId,
          model.modelName,
          model.sortOrder,
          model.effortValues,
          model.effortDefault,
        ).changes;
      }

      // Every upload's record comes back with the assets area; one this
      // installation already lists keeps its own project.
      for (const file of snapshot.uploadedFiles ?? []) {
        result.uploadedFiles += insertUploadedFile.run(
          file.storedName,
          file.originalName,
          file.mimeType,
          file.size,
          file.projectPath ? normalizeProjectPath(file.projectPath) : null,
          file.sessionId,
          file.createdAt,
        ).changes;
      }

      // Artefacts come back for the importing account. Each is linked to its
      // conversation again when that session exists now (restored by this
      // import or already here); otherwise opening it starts a new one.
      if (selection.artefacts) {
        const stamp = selection.now.toISOString();
        for (const artefact of selection.artefacts.records) {
          result.artefacts += insertArtefact.run(
            artefact.id,
            selection.userId,
            artefact.kind,
            artefact.title,
            path.join(selection.artefacts.directory, artefact.fileName),
            artefact.sessionId && sessionExists.get(artefact.sessionId) ? artefact.sessionId : null,
            artefact.pinned ? 1 : 0,
            artefact.createdAt ?? stamp,
            artefact.updatedAt ?? stamp,
            artefact.openedAt ?? stamp,
          ).changes;
        }
      }
    })();

    return result;
  },

  /**
   * Puts the backup's title and archive flag back on restored sessions after
   * the indexer has read their transcripts: indexing a transcript may replace
   * a title with the transcript's own and clears the archive flag when it
   * thinks the file has new activity.
   */
  restoreSessionFlags(sessions: BackupSessionRecord[]): void {
    const db = getConnection();
    const update = db.prepare(
      `UPDATE sessions SET isArchived = ?, custom_name = COALESCE(?, custom_name) WHERE session_id = ?`
    );
    db.transaction(() => {
      for (const session of sessions) {
        update.run(session.isArchived ? 1 : 0, session.customName, session.sessionId);
      }
    })();
  },
};
