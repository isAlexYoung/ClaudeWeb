export { initializeDatabase } from '@/modules/database/init-db.js';
export { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
export { apiKeysDb } from '@/modules/database/repositories/api-keys.js';
export { appConfigDb } from '@/modules/database/repositories/app-config.js';
// backupDb: used by Backup to export one user's ClaudeWeb rows and merge them back after a reinstall.
export { backupDb } from '@/modules/database/repositories/backup.db.js';
export { credentialsDb } from '@/modules/database/repositories/credentials.js';
export { githubTokensDb } from '@/modules/database/repositories/github-tokens.js';
export { notificationChannelEndpointsDb } from '@/modules/database/repositories/notification-channel-endpoints.js';
export { notificationPreferencesDb } from '@/modules/database/repositories/notification-preferences.js';
// providerModelsDb: used by Providers to persist user-managed custom model rows.
export { providerModelsDb } from '@/modules/database/repositories/provider-models.js';
// projectsDb: used by Projects, Worktrees, Git, WebSocket, and notification modules to persist and resolve project records.
export { projectsDb } from '@/modules/database/repositories/projects.db.js';
export { pushSubscriptionsDb } from '@/modules/database/repositories/push-subscriptions.js';
export { scanStateDb } from '@/modules/database/repositories/scan-state.db.js';
// sessionDraftsDb: used by User for drafts and Scheduled Messages for server-owned queued turns.
export { sessionDraftsDb } from '@/modules/database/repositories/session-drafts.db.js';
export type {
  QueuedSessionMessageRecord,
  SessionDraftRecord,
} from '@/modules/database/repositories/session-drafts.db.js';
export { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
// uploadedFilesDb: used by Assets for the project File management page and the upload index.
export { uploadedFilesDb } from '@/modules/database/repositories/uploaded-files.db.js';
export type { UploadedFileRow } from '@/modules/database/repositories/uploaded-files.db.js';
export { userDb } from '@/modules/database/repositories/users.js';
// userPreferencesDb: used by the User module to persist the settings that used to live in browser localStorage.
export { userPreferencesDb } from '@/modules/database/repositories/user-preferences.db.js';
export { vapidKeysDb } from '@/modules/database/repositories/vapid-keys.js';
export { scheduledMessagesDb } from './repositories/scheduled-messages.db.js';
export type { ScheduledMessageRow, ScheduledMessageStatus } from './repositories/scheduled-messages.db.js';
// scheduledTasksDb: used by Scheduled Tasks for recurring prompts that each start a new conversation.
export { scheduledTasksDb, RUNS_KEPT_PER_TASK } from './repositories/scheduled-tasks.db.js';
export type {
  ScheduledTaskFields,
  ScheduledTaskPermission,
  ScheduledTaskRow,
  ScheduledTaskRunRow,
  ScheduledTaskRunStatus,
  ScheduledTaskRunTrigger,
} from './repositories/scheduled-tasks.db.js';

export { sideChatsDb } from './repositories/side-chats.db.js';
