import { statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createBackupDownloadRouter, createBackupRouter } from '@/modules/backup/backup.routes.js';
import { createBackupService } from '@/modules/backup/backup.service.js';
import { getArtefactsDirectory } from '@/modules/artefacts/index.js';
import { backupDb } from '@/modules/database/index.js';
import { scanPlugins } from '@/modules/plugins/index.js';
import { sessionSynchronizerService } from '@/modules/providers/index.js';
import { broadcastSessionUpsertedBatch } from '@/modules/websocket/index.js';

const homeDirectory = os.homedir();

const backupService = createBackupService({
  homeDirectory,
  claudeHome: path.join(homeDirectory, '.claude'),
  claudewebHome: path.join(homeDirectory, '.claudeweb'),
  uploadsDirectory: path.join(homeDirectory, '.claudeweb', 'backup-imports'),
  artefactsDirectory: getArtefactsDirectory(),
  database: {
    exportSnapshot: (userId) => backupDb.exportSnapshot(userId),
    findKnownProviderSessionIds: (ids) => backupDb.findKnownProviderSessionIds(ids),
    findKnownArtefactIds: (ids) => backupDb.findKnownArtefactIds(ids),
    mergeSnapshot: (snapshot, selection) => backupDb.mergeSnapshot(snapshot, selection),
    restoreSessionFlags: (sessions) => backupDb.restoreSessionFlags(sessions),
  },
  reindexTranscript: async (filePath) => {
    await sessionSynchronizerService.synchronizeProviderFile('claude', filePath);
  },
  announceSessions: (sessionIds) => broadcastSessionUpsertedBatch(sessionIds),
  plugins: {
    list: () => scanPlugins().map((plugin: { name: string; displayName?: string; repoUrl: string | null; enabled: boolean; bundled: boolean }) => ({
      name: plugin.name, displayName: plugin.displayName, repoUrl: plugin.repoUrl, enabled: plugin.enabled, bundled: plugin.bundled,
    })),
  },
  freeBytes: async (directory) => {
    const stats = await statfs(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  },
});

// Uploads abandoned by an earlier run (closed tab, restart) are removed after a day.
void backupService.cleanupStaleImports().catch((error: unknown) => {
  console.error('[Backup] Could not clean up old uploads', error);
});

/** Backup router assembled for the authenticated server mount at `/api/backup`. */
export const backupRoutes = createBackupRouter(backupService);

/** One-time download router mounted at `/api/backup-download`. */
export const backupDownloadRoutes = createBackupDownloadRouter(backupService);
