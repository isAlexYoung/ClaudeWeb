import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform, type TransformCallback, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import { Parser, type ReadEntry } from 'tar';

import {
  BACKUP_AREAS,
  BACKUP_DATA_ENTRY,
  BACKUP_FORMAT_NAME,
  LEGACY_BACKUP_FORMAT_NAME,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_ENTRY,
  BACKUP_PASSWORD_MAX_LENGTH,
  BACKUP_PASSWORD_MIN_LENGTH,
  BackupDecryptStream,
  BackupEncryptStream,
  CLAUDE_USER_FILES,
  CLAUDE_USER_FOLDERS,
  ENCRYPTED_HEADER_BYTES,
  TAR_END_OF_ARCHIVE,
  classifyBackupEntryPath,
  createEncryptedHeader,
  deriveBackupKey,
  detectBackupFormat,
  encodeTarFileHeader,
  parseEncryptedHeader,
  tarPadding,
  type BackupArea,
  type BackupEntryTarget,
  type EncryptedBackupHeader,
} from '@/modules/backup/backup-archive.service.js';
import type {
  BackupDatabaseSnapshot,
  BackupMergeResult,
  BackupMergeSelection,
  BackupSessionRecord,
} from '@/shared/types.js';
import { normalizeTimeZone, readSchedule } from '@/modules/scheduled-tasks/index.js';
import { AppError, normalizeScheduledTaskPermission } from '@/shared/utils.js';

/**
 * Size of one upload piece. Requests through Cloudflare are capped at 100 MB
 * and a proxy may give each request only a few minutes, so a backup of
 * any size is sent as many small requests. Used by the Backup routes to cap
 * the raw body parser.
 */
export const BACKUP_CHUNK_BYTES = 8 * 1024 * 1024;

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 500_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_DATA_BYTES = 256 * 1024 * 1024;
const TRANSCRIPT_HEAD_BYTES = 256 * 1024;
// Kept free on top of what an upload or import needs, so the VPS never fills up.
const DISK_RESERVE_BYTES = 256 * 1024 * 1024;
const EXPORT_TICKET_TTL_MS = 2 * 60 * 1000;
const STALE_IMPORT_MS = 24 * 60 * 60 * 1000;
const UPLOAD_SUFFIX = '.upload';
const RESTORE_TEMP_SUFFIX = '.claudeweb-restore.tmp';

type BackupServiceDependencies = {
  /** Home of the service user; recorded in the manifest so a preview can say where a backup came from. */
  homeDirectory: string;
  claudeHome: string;
  claudewebHome: string;
  /** Where uploads are kept. Not /tmp: /tmp may be a small memory-backed mount. */
  uploadsDirectory: string;
  database: {
    exportSnapshot(userId: number): BackupDatabaseSnapshot;
    findKnownProviderSessionIds(providerSessionIds: string[]): Set<string>;
    mergeSnapshot(snapshot: BackupDatabaseSnapshot, selection: BackupMergeSelection): BackupMergeResult;
    restoreSessionFlags(sessions: BackupSessionRecord[]): void;
  };
  /** Indexes one restored transcript so it appears without waiting for a rescan. */
  reindexTranscript(filePath: string): Promise<void>;
  /** Tells open browser tabs about restored sessions. */
  announceSessions(sessionIds: string[]): Promise<void>;
  /** Free bytes on the filesystem holding `directory` (or its nearest existing parent). */
  freeBytes(directory: string): Promise<number>;
  /** Installed plugins; a backup records their names and sources, never their code or keys. */
  plugins?: { list(): Array<{ name: string; displayName?: string; repoUrl: string | null; enabled: boolean; bundled: boolean }> };
  now?: () => Date;
  logger?: { error(message: string, error?: unknown): void };
};

/** `projectFiles`: project folders to include, as paths relative to the home folder ("/"-separated). */
type ExportTicket = { userId: number; password: string | null; fileName: string; expiresAt: number; projectFiles: string[] };

const MAX_PROJECT_FOLDERS = 1000;

type ImportState = 'uploading' | 'uploaded' | 'reading' | 'password' | 'ready' | 'importing' | 'done' | 'failed';

type BackupPreviewProject = {
  /** The transcript folder name under ~/.claude/projects; the id the client sends back. */
  id: string;
  name: string;
  path: string | null;
  pathExists: boolean;
  sessionCount: number;
  existingSessionCount: number;
  /** Bytes this project would add (existing sessions and files are skipped). */
  newBytes: number;
  /** Project files in the backup for this project that do not exist here yet. */
  fileCount: number;
  fileBytes: number;
};

type BackupPreview = {
  createdAt: string | null;
  sourceHome: string | null;
  /** Set when the backup came from another home folder: paths under `from` are restored under `to`. */
  relocation: { from: string; to: string } | null;
  /** Plugins installed where the backup was made, to reinstall here from their sources. */
  plugins: BackupPlugin[];
  encrypted: boolean;
  projects: BackupPreviewProject[];
  /** Bytes outside any project (chat images, task lists of unknown sessions). */
  sharedNewBytes: number;
  freeBytes: number;
};

type BackupImportResult = {
  restoredSessions: number;
  skippedExistingSessions: number;
  restoredFiles: number;
  skippedExistingFiles: number;
  database: BackupMergeResult;
};

type ScannedFile = { area: BackupArea; segments: string[]; size: number };

type BackupPlugin = { name: string; displayName: string | null; repoUrl: string; enabled: boolean; installed: boolean };

/** How paths under the exporting server's home folder map to this one. */
type Relocation = { from: string; to: string; fromFolder: string; toFolder: string };

type ImportPlan = {
  snapshot: BackupDatabaseSnapshot;
  /** Provider session id -> its transcript folder. */
  sessionFolders: Map<string, string>;
  /** Sessions this account already has; their files are never written. */
  existingSessions: Set<string>;
  /** Transcript folder -> absolute project path on this server, when known. */
  folderPaths: Map<string, string | null>;
  relocation: Relocation | null;
  /** Exported project folders (relative to home), longest first, and the preview project each belongs to. */
  workspaceDirs: Array<{ dir: string; projectId: string }>;
};

type ImportJob = {
  id: string;
  userId: number;
  filePath: string;
  size: number;
  received: number;
  state: ImportState;
  error: { code: string; message: string } | null;
  format: 'plain' | 'encrypted' | null;
  encryption: { header: EncryptedBackupHeader; key: Buffer } | null;
  plan: ImportPlan | null;
  preview: BackupPreview | null;
  result: BackupImportResult | null;
  progress: { processedBytes: number; totalBytes: number } | null;
  abort: ((error: Error) => void) | null;
  touchedAt: number;
};

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function toPublicError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  if (/TAR_|Truncated|unexpected end|incorrect header|invalid (?:stored|block|distance)|unknown compression/i.test(message)) {
    return { code: 'BACKUP_CORRUPTED', message: 'The backup file is damaged or incomplete' };
  }
  if (errorCode(error) === 'ENOSPC') return { code: 'BACKUP_DISK_FULL', message: 'The disk is full' };
  return { code: 'BACKUP_IMPORT_FAILED', message };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Validates `claudeweb/data.json` from an untrusted archive. Malformed rows are
 * dropped one by one instead of failing the import: the transcripts matter
 * more than any single title.
 */
function parseSnapshot(raw: unknown): BackupDatabaseSnapshot {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rows = (key: string): Record<string, unknown>[] => (Array.isArray(source[key])
    ? (source[key] as unknown[]).filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : []);

  return {
    version: 1,
    projects: rows('projects')
      .filter((row) => typeof row.projectId === 'string' && typeof row.projectPath === 'string' && path.isAbsolute(row.projectPath))
      .map((row) => ({
        projectId: row.projectId as string,
        projectPath: row.projectPath as string,
        customProjectName: stringOrNull(row.customProjectName),
        isStarred: row.isStarred === true,
        isArchived: row.isArchived === true,
      })),
    sessions: rows('sessions')
      .filter((row) => typeof row.sessionId === 'string' && row.sessionId && typeof row.providerSessionId === 'string' && row.providerSessionId)
      .map((row) => ({
        sessionId: row.sessionId as string,
        providerSessionId: row.providerSessionId as string,
        projectPath: typeof row.projectPath === 'string' && path.isAbsolute(row.projectPath) ? row.projectPath : null,
        customName: stringOrNull(row.customName),
        model: stringOrNull(row.model),
        effort: stringOrNull(row.effort),
        forkedFromSessionId: stringOrNull(row.forkedFromSessionId),
        isArchived: row.isArchived === true,
        createdAt: stringOrNull(row.createdAt),
        updatedAt: stringOrNull(row.updatedAt),
      })),
    preferences: rows('preferences')
      .filter((row) => typeof row.key === 'string' && row.key && typeof row.value === 'string' && (() => {
        try { JSON.parse(row.value as string); return true; } catch { return false; }
      })())
      .map((row) => ({ key: row.key as string, value: row.value as string })),
    drafts: rows('drafts')
      .filter((row) => typeof row.scope === 'string' && row.scope && typeof row.text === 'string')
      .map((row) => ({
        scope: row.scope as string,
        text: row.text as string,
        queuedMessage: stringOrNull(row.queuedMessage),
        updatedAt: stringOrNull(row.updatedAt),
      })),
    scheduledMessages: rows('scheduledMessages')
      .filter((row) => ['id', 'sessionId', 'content', 'options', 'scheduledFor', 'status'].every((key) => typeof row[key] === 'string')
        && ['pending', 'sent', 'failed', 'cancelled'].includes(row.status as string))
      .map((row) => ({
        id: row.id as string,
        sessionId: row.sessionId as string,
        content: row.content as string,
        options: row.options as string,
        scheduledFor: row.scheduledFor as string,
        status: row.status as string,
        failureReason: stringOrNull(row.failureReason),
        createdAt: stringOrNull(row.createdAt),
        updatedAt: stringOrNull(row.updatedAt),
      })),
    // Older backups have no scheduled tasks; a row whose schedule cannot be
    // read is dropped, like any other malformed row.
    scheduledTasks: rows('scheduledTasks')
      .filter((row) => ['id', 'name', 'projectPath', 'prompt', 'schedule', 'timezone', 'toolsSettings']
        .every((key) => typeof row[key] === 'string' && (row[key] as string).length > 0)
        && (row.name as string).length <= 100 && (row.prompt as string).length <= 100_000
        && path.isAbsolute(row.projectPath as string) && readSchedule(row.schedule as string) !== null)
      .map((row) => ({
        id: row.id as string,
        name: row.name as string,
        projectPath: row.projectPath as string,
        prompt: row.prompt as string,
        schedule: JSON.stringify(readSchedule(row.schedule as string)),
        timezone: normalizeTimeZone(row.timezone),
        model: stringOrNull(row.model),
        permission: normalizeScheduledTaskPermission(row.permission),
        toolsSettings: (() => {
          try { return JSON.stringify(JSON.parse(row.toolsSettings as string)); } catch { return '{}'; }
        })(),
        createdAt: stringOrNull(row.createdAt),
      })),
    providerModels: rows('providerModels')
      .filter((row) => typeof row.modelId === 'string' && row.modelId && typeof row.modelName === 'string' && Number.isInteger(row.sortOrder))
      .map((row) => ({
        modelId: row.modelId as string,
        modelName: row.modelName as string,
        sortOrder: row.sortOrder as number,
        effortValues: stringOrNull(row.effortValues),
        effortDefault: stringOrNull(row.effortDefault),
      })),
    // Older backups have none. Names must be a single safe path segment,
    // since they point into the assets folder.
    uploadedFiles: rows('uploadedFiles')
      .filter((row) => typeof row.storedName === 'string' && /^[A-Za-z0-9._-]{1,255}$/.test(row.storedName)
        && !row.storedName.startsWith('.') && typeof row.originalName === 'string' && row.originalName.length > 0
        && row.originalName.length <= 255 && Number.isSafeInteger(row.size) && (row.size as number) >= 0)
      .map((row) => ({
        storedName: row.storedName as string,
        originalName: row.originalName as string,
        mimeType: stringOrNull(row.mimeType),
        size: row.size as number,
        projectPath: typeof row.projectPath === 'string' && path.isAbsolute(row.projectPath) ? row.projectPath : null,
        sessionId: stringOrNull(row.sessionId),
        createdAt: stringOrNull(row.createdAt),
      })),
  };
}

/** Claude names a project's transcript folder after its path with every non-alphanumeric character as "-". */
function claudeProjectFolderName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * The move from the exporting server's home folder to this one, or null when
 * they are the same (or the backup does not say). WebDesktop's ClaudeWeb ran in
 * /home/wdguest; standalone ClaudeWeb runs in /home/claudeweb.
 */
function relocationFor(sourceHome: unknown, home: string): Relocation | null {
  if (typeof sourceHome !== 'string' || !sourceHome.startsWith('/') || sourceHome.includes('\0')) return null;
  const from = path.posix.normalize(sourceHome).replace(/\/+$/, '');
  const to = path.resolve(home);
  if (!from || from === to || from.split('/').includes('..')) return null;
  return { from, to, fromFolder: claudeProjectFolderName(from), toFolder: claudeProjectFolderName(to) };
}

function relocatePath(relocation: Relocation | null, value: string): string;
function relocatePath(relocation: Relocation | null, value: string | null): string | null;
function relocatePath(relocation: Relocation | null, value: string | null): string | null {
  if (!relocation || value === null) return value;
  if (value === relocation.from) return relocation.to;
  if (!value.startsWith(relocation.from + '/')) return value;
  return path.join(relocation.to, ...value.slice(relocation.from.length + 1).split('/'));
}

/** A transcript folder is its project path with every non-alphanumeric character as "-", so the home part is a prefix. */
function relocateFolder(relocation: Relocation | null, folder: string): string {
  if (!relocation) return folder;
  if (folder !== relocation.fromFolder && !folder.startsWith(relocation.fromFolder + '-')) return folder;
  return relocation.toFolder + folder.slice(relocation.fromFolder.length);
}

function relocateSnapshot(relocation: Relocation | null, snapshot: BackupDatabaseSnapshot): BackupDatabaseSnapshot {
  if (!relocation) return snapshot;
  return {
    ...snapshot,
    projects: snapshot.projects.map((row) => ({ ...row, projectPath: relocatePath(relocation, row.projectPath) })),
    sessions: snapshot.sessions.map((row) => ({ ...row, projectPath: relocatePath(relocation, row.projectPath) })),
    scheduledTasks: snapshot.scheduledTasks.map((row) => ({ ...row, projectPath: relocatePath(relocation, row.projectPath) })),
    uploadedFiles: snapshot.uploadedFiles.map((row) => ({ ...row, projectPath: relocatePath(relocation, row.projectPath) })),
  };
}

/**
 * Rewrites every `"cwd"` in a transcript to the new home folder, line by line,
 * so Claude resumes the conversation in the project's new place.
 */
class TranscriptRelocation extends Transform {
  private rest = '';

  constructor(private readonly relocation: Relocation) {
    super();
  }

  private rewrite(text: string): string {
    if (!text.includes(this.relocation.from)) return text;
    return text.replace(/"cwd":"((?:[^"\\]|\\.)*)"/g, (match, raw: string) => {
      try {
        return `"cwd":${JSON.stringify(relocatePath(this.relocation, JSON.parse(`"${raw}"`) as string))}`;
      } catch {
        return match;
      }
    });
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const text = this.rest + chunk.toString('utf8');
    const end = text.lastIndexOf('\n');
    if (end === -1) {
      this.rest = text;
    } else {
      this.rest = text.slice(end + 1);
      this.push(Buffer.from(this.rewrite(text.slice(0, end + 1)), 'utf8'));
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    if (this.rest) this.push(Buffer.from(this.rewrite(this.rest), 'utf8'));
    callback();
  }
}

/** The exported project folder a `files/` entry belongs to; folders are sorted longest first. */
function workspaceOwner(dirs: Array<{ dir: string; projectId: string }>, segments: string[]): { dir: string; projectId: string } | null {
  const relative = segments.join('/');
  return dirs.find(({ dir }) => relative.startsWith(dir + '/')) ?? null;
}

/** A projects-area entry placed under this server's transcript folder name. */
function relocatedTarget(
  relocation: Relocation | null,
  target: Extract<BackupEntryTarget, { kind: 'file' }>,
): Extract<BackupEntryTarget, { kind: 'file' }> {
  if (!relocation || target.area !== 'projects' || target.segments.length === 0) return target;
  return { ...target, segments: [relocateFolder(relocation, target.segments[0]), ...target.segments.slice(1)] };
}

/** Plugins listed in a manifest: a plain name and an https source; anything else is dropped. */
function manifestPlugins(value: unknown): Array<Omit<BackupPlugin, 'installed'>> {
  if (!Array.isArray(value)) return [];
  const plugins: Array<Omit<BackupPlugin, 'installed'>> = [];
  for (const item of value.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(row.name)) continue;
    if (typeof row.repoUrl !== 'string' || row.repoUrl.length > 500 || !/^https:\/\/[^\s@]+$/.test(row.repoUrl)) continue;
    if (plugins.some((plugin) => plugin.name === row.name)) continue;
    plugins.push({
      name: row.name,
      displayName: typeof row.displayName === 'string' ? row.displayName.slice(0, 200) : null,
      repoUrl: row.repoUrl,
      enabled: row.enabled !== false,
    });
  }
  return plugins;
}

/** The preview entry for Claude's user settings; chosen or not like a project. */
const CLAUDE_USER_ID = '@claude-user';

/** `env` entries that hold secrets are left out of a backup, like the sign-in itself. */
const SECRET_SETTING = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;

/** Claude's user settings.json without secret `env` entries; null when it is not a JSON object. */
function settingsWithoutSecrets(raw: string): Buffer | null {
  let settings: unknown;
  try {
    settings = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const copy = { ...(settings as Record<string, unknown>) };
  if (copy.env && typeof copy.env === 'object' && !Array.isArray(copy.env)) {
    copy.env = Object.fromEntries(Object.entries(copy.env as Record<string, unknown>).filter(([name]) => !SECRET_SETTING.test(name)));
  }
  return Buffer.from(`${JSON.stringify(copy, null, 2)}\n`);
}

/** Every string under the old home folder in a JSON document, moved to the new one (hook and status-line paths). */
class JsonRelocation extends Transform {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly relocation: Relocation) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > MAX_MANIFEST_BYTES) {
      callback(new AppError('A Claude settings file in the backup is too large', { code: 'BACKUP_UNSAFE_ENTRY', statusCode: 400 }));
      return;
    }
    this.chunks.push(chunk);
    callback();
  }

  override _flush(callback: TransformCallback): void {
    const raw = Buffer.concat(this.chunks).toString('utf8');
    const move = (value: unknown): unknown => {
      if (typeof value === 'string') return relocatePath(this.relocation, value);
      if (Array.isArray(value)) return value.map(move);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, move(item)]));
      return value;
    };
    try {
      this.push(Buffer.from(`${JSON.stringify(move(JSON.parse(raw)), null, 2)}\n`));
    } catch {
      this.push(Buffer.from(raw));
    }
    callback();
  }
}

/** Project folders listed in a manifest: relative, "/"-separated, not hidden, no "..". */
function manifestProjectFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((dir): dir is string => typeof dir === 'string' && dir.length > 0 && dir.length <= 4096
    && !dir.startsWith('/') && !dir.startsWith('.') && !dir.includes('\\') && !dir.includes('\0')
    && dir.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'));
}

/** Session id of a Claude task-list file (`<session>-agent-<agent>.json`), if it is one. */
function todoSessionId(fileName: string): string | null {
  const match = /^(.+?)-agent-.+\.json$/.exec(fileName);
  return match ? match[1] : null;
}

/** First `cwd` in the head of a transcript: the absolute project path the session ran in. */
function transcriptWorkingDirectory(head: Buffer): string | null {
  for (const line of head.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line) as Record<string, unknown>;
      if (typeof data.cwd === 'string' && path.isAbsolute(data.cwd)) return data.cwd;
    } catch {
      // The last line of the head is usually cut off; keep looking at the others.
    }
  }
  return null;
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Reads a whole entry into memory, refusing entries larger than `limit`. */
function collectEntry(entry: ReadEntry, limit: number): Promise<Buffer> {
  if ((entry.size ?? 0) > limit) {
    entry.resume();
    return Promise.reject(new AppError(`${entry.path} is too large`, { code: 'BACKUP_UNSAFE_ENTRY', statusCode: 400 }));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    entry.on('data', (chunk: Buffer) => chunks.push(chunk));
    entry.on('end', () => resolve(Buffer.concat(chunks)));
    entry.on('error', reject);
  });
}

/** Reads the first `limit` bytes of an entry and discards the rest. */
function collectEntryHead(entry: ReadEntry, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let collected = 0;
    entry.on('data', (chunk: Buffer) => {
      if (collected < limit) {
        const part = chunk.subarray(0, limit - collected);
        chunks.push(part);
        collected += part.length;
      }
    });
    entry.on('end', () => resolve(Buffer.concat(chunks)));
    entry.on('error', reject);
  });
}

/** Pipes one entry (through `transform`, if given) into a new file and waits until the file is closed. */
function writeEntryTo(entry: ReadEntry, filePath: string, mode = 0o600, transform: Transform | null = null): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(filePath, { flags: 'wx', mode });
    let failed: unknown = null;
    output.on('error', (error) => {
      failed = error;
      entry.resume();
      reject(error);
    });
    entry.on('error', (error: unknown) => {
      failed = error;
      output.destroy();
      reject(error);
    });
    output.on('close', () => {
      if (!failed) resolve();
    });
    if (transform) {
      transform.on('error', (error: unknown) => {
        failed = error;
        output.destroy();
        reject(error);
      });
      entry.pipe(transform).pipe(output);
    } else {
      entry.pipe(output);
    }
  });
}

/** Used by the Backup module composition root to build the export and import service. */
export function createBackupService(dependencies: BackupServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? { error: (message: string, error?: unknown) => console.error(message, error) };
  const exportTickets = new Map<string, ExportTicket>();
  const imports = new Map<string, ImportJob>();

  const areaRoots: Record<BackupArea, string> = {
    projects: path.join(dependencies.claudeHome, 'projects'),
    fileHistory: path.join(dependencies.claudeHome, 'file-history'),
    todos: path.join(dependencies.claudeHome, 'todos'),
    assets: path.join(dependencies.claudewebHome, 'assets'),
    claudeUser: dependencies.claudeHome,
    workspace: path.resolve(dependencies.homeDirectory),
  };

  /** A project folder inside the home folder, as a "/"-separated relative path; null when it is outside or hidden. */
  function homeRelative(projectPath: string): string | null {
    const relative = path.relative(areaRoots.workspace, path.resolve(projectPath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const parts = relative.split(path.sep);
    return parts[0].startsWith('.') ? null : parts.join('/');
  }

  async function isDirectory(target: string): Promise<boolean> {
    try {
      return (await lstat(target)).isDirectory();
    } catch (error) {
      if (isMissing(error) || errorCode(error) === 'ENOTDIR') return false;
      throw error;
    }
  }

  /** The account's projects whose folders can go into a backup: inside the home folder and present. */
  async function projectFolders(userId: number): Promise<Array<{ path: string; name: string; relative: string }>> {
    const seen = new Set<string>();
    const folders: Array<{ path: string; name: string; relative: string }> = [];
    for (const project of dependencies.database.exportSnapshot(userId).projects) {
      const relative = homeRelative(project.projectPath);
      if (!relative || seen.has(relative) || !(await isDirectory(project.projectPath))) continue;
      seen.add(relative);
      folders.push({ path: project.projectPath, name: project.customProjectName?.trim() || path.basename(project.projectPath), relative });
    }
    return folders.sort((left, right) => left.name.localeCompare(right.name));
  }

  // ---------------------------------------------------------------- export

  function validatePassword(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length < BACKUP_PASSWORD_MIN_LENGTH || value.length > BACKUP_PASSWORD_MAX_LENGTH) {
      throw new AppError(`The password must be ${BACKUP_PASSWORD_MIN_LENGTH} to ${BACKUP_PASSWORD_MAX_LENGTH} characters`, {
        code: 'BACKUP_PASSWORD_INVALID',
        statusCode: 400,
      });
    }
    return value;
  }

  async function* walkFiles(root: string, relative = ''): AsyncGenerator<{ relative: string; absolute: string; stats: Stats }> {
    const directory = relative ? path.join(root, ...relative.split('/')) : root;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error) || errorCode(error) === 'ENOTDIR') return;
      throw error;
    }
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      // Links are never followed: they could point anywhere on the VPS.
      if (entry.isSymbolicLink()) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        yield* walkFiles(root, childRelative);
      } else if (entry.isFile() && !entry.name.endsWith(RESTORE_TEMP_SUFFIX)) {
        const absolute = path.join(directory, entry.name);
        try {
          yield { relative: childRelative, absolute, stats: await lstat(absolute) };
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
    }
  }

  function* memoryEntry(name: string, content: Buffer): Generator<Buffer> {
    yield encodeTarFileHeader(name, content.length, now());
    yield content;
    yield tarPadding(content.length);
  }

  async function* fileEntry(name: string, absolute: string, stats: Stats, mode = 0o600): AsyncGenerator<Buffer> {
    const size = stats.size;
    yield encodeTarFileHeader(name, size, stats.mtime, mode);
    let written = 0;
    if (size > 0) {
      try {
        // A transcript can grow while it is read; the header already fixed its size.
        for await (const chunk of createReadStream(absolute, { start: 0, end: size - 1 })) {
          const part = (chunk as Buffer).subarray(0, size - written);
          written += part.length;
          yield part;
          if (written >= size) break;
        }
      } catch (error) {
        logger.error(`[Backup] ${absolute} could not be read completely`, error);
      }
    }
    for (let remaining = size - written; remaining > 0; remaining -= BACKUP_CHUNK_BYTES) {
      yield Buffer.alloc(Math.min(remaining, BACKUP_CHUNK_BYTES));
    }
    yield tarPadding(size);
  }

  async function* archiveBytes(ticket: ExportTicket): AsyncGenerator<Buffer> {
    const manifest = {
      format: BACKUP_FORMAT_NAME,
      version: BACKUP_FORMAT_VERSION,
      createdAt: now().toISOString(),
      sourceHome: dependencies.homeDirectory,
      contents: BACKUP_AREAS.filter((area) => area.area !== 'workspace' || ticket.projectFiles.length > 0).map((area) => area.prefix),
      projectFiles: ticket.projectFiles,
      // Plugins the user installed from a repository; bundled ones come with ClaudeWeb.
      plugins: (dependencies.plugins?.list() ?? [])
        .filter((plugin) => !plugin.bundled && typeof plugin.repoUrl === 'string' && plugin.repoUrl.startsWith('https://'))
        .map((plugin) => ({ name: plugin.name, displayName: plugin.displayName ?? null, repoUrl: plugin.repoUrl, enabled: plugin.enabled })),
    };
    yield* memoryEntry(BACKUP_MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2)));
    yield* memoryEntry(BACKUP_DATA_ENTRY, Buffer.from(JSON.stringify(dependencies.database.exportSnapshot(ticket.userId))));

    for (const { area, prefix } of BACKUP_AREAS) {
      if (area === 'workspace') continue;
      if (area === 'claudeUser') {
        yield* claudeUserEntries(prefix);
        continue;
      }
      for await (const file of walkFiles(areaRoots[area])) {
        const name = prefix + file.relative;
        try {
          // The importer refuses an archive with any unsafe name; leave such a file out instead.
          classifyBackupEntryPath(name);
        } catch {
          logger.error(`[Backup] Skipping ${file.absolute}: its name cannot be restored safely`);
          continue;
        }
        yield* fileEntry(name, file.absolute, file.stats);
      }
    }

    // Project folders as they are now, with their permissions; links are left out.
    for (const dir of ticket.projectFiles) {
      for await (const file of walkFiles(path.join(areaRoots.workspace, ...dir.split('/')))) {
        const name = `files/${dir}/${file.relative}`;
        try {
          classifyBackupEntryPath(name);
        } catch {
          logger.error(`[Backup] Skipping ${file.absolute}: its name cannot be restored safely`);
          continue;
        }
        yield* fileEntry(name, file.absolute, file.stats, (file.stats.mode & 0o755) | 0o600);
      }
    }
    yield TAR_END_OF_ARCHIVE;
  }

  /** Claude's user settings: only the listed files and folders, settings.json without secrets. */
  async function* claudeUserEntries(prefix: string): AsyncGenerator<Buffer> {
    for (const name of CLAUDE_USER_FILES) {
      const absolute = path.join(areaRoots.claudeUser, name);
      let stats: Stats;
      try {
        stats = await lstat(absolute);
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      if (!stats.isFile()) continue;
      if (name === 'settings.json') {
        const content = settingsWithoutSecrets(await readFile(absolute, 'utf8'));
        if (content) yield* memoryEntry(prefix + name, content);
        else logger.error(`[Backup] Skipping ${absolute}: it is not a JSON object`);
      } else {
        yield* fileEntry(prefix + name, absolute, stats);
      }
    }
    for (const folder of CLAUDE_USER_FOLDERS) {
      for await (const file of walkFiles(path.join(areaRoots.claudeUser, folder))) {
        const name = `${prefix}${folder}/${file.relative}`;
        try {
          classifyBackupEntryPath(name);
        } catch {
          logger.error(`[Backup] Skipping ${file.absolute}: its name cannot be restored safely`);
          continue;
        }
        // Skills may carry scripts; their execute bits are kept, set-id bits never.
        yield* fileEntry(name, file.absolute, file.stats, (file.stats.mode & 0o755) | 0o600);
      }
    }
  }

  // ---------------------------------------------------------------- import helpers

  function findJob(userId: number, importId: string): ImportJob {
    const job = imports.get(importId);
    if (!job || job.userId !== userId) {
      throw new AppError('This upload no longer exists. Choose the backup file again.', {
        code: 'BACKUP_IMPORT_NOT_FOUND',
        statusCode: 404,
      });
    }
    job.touchedAt = Date.now();
    return job;
  }

  function wrongState(): AppError {
    return new AppError('The upload is not in a state that allows this step', { code: 'BACKUP_IMPORT_STATE', statusCode: 409 });
  }

  function statusOf(job: ImportJob) {
    return {
      importId: job.id,
      state: job.state,
      size: job.size,
      received: job.received,
      encrypted: job.format === null ? null : job.format === 'encrypted',
      error: job.error,
      progress: job.progress,
      preview: job.preview,
      result: job.result,
    };
  }

  async function freeBytesNear(directory: string): Promise<number> {
    let current = directory;
    while (!(await exists(current))) {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return dependencies.freeBytes(current);
  }

  function diskFull(requiredBytes: number, freeBytes: number): AppError {
    return new AppError('There is not enough free disk space', {
      code: 'BACKUP_DISK_FULL',
      statusCode: 507,
      details: { requiredBytes, freeBytes },
    });
  }

  async function discardJob(job: ImportJob): Promise<void> {
    imports.delete(job.id);
    await rm(job.filePath, { force: true });
  }

  /**
   * Streams the uploaded archive through decryption and the tar parser, calling
   * `onFile` for each validated regular file. Links, devices and every other
   * entry type refuse the whole archive.
   */
  function readArchive(
    job: ImportJob,
    handlers: {
      onManifest(entry: ReadEntry): Promise<void>;
      onData(entry: ReadEntry): Promise<void>;
      onFile(entry: ReadEntry, target: Extract<BackupEntryTarget, { kind: 'file' }>): Promise<void>;
    },
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const source = createReadStream(job.filePath, { start: job.encryption ? ENCRYPTED_HEADER_BYTES : 0 });
      const decrypt: Transform | null = job.encryption ? new BackupDecryptStream(job.encryption.key, job.encryption.header) : null;
      const parser = new Parser({ strict: true });
      const pending: Promise<void>[] = [];
      // Entries whose body has not been read to the end; destroyed on failure so no handler waits forever.
      const active = new Set<ReadEntry>();
      let failure: unknown = null;
      let entries = 0;
      let settled = false;

      job.progress = { processedBytes: 0, totalBytes: job.size };
      source.on('data', (chunk) => {
        if (job.progress) job.progress.processedBytes += chunk.length;
      });

      const finish = (error: unknown) => {
        if (settled) return;
        settled = true;
        job.abort = null;
        void Promise.allSettled(pending).then(() => {
          const cause = failure ?? error;
          if (cause) reject(cause);
          else resolve();
        });
      };
      const fail = (error: unknown) => {
        if (!failure) failure = error;
        source.destroy();
        for (const entry of active) entry.destroy(error instanceof Error ? error : new Error(String(error)));
        active.clear();
        finish(error);
      };
      job.abort = (error) => fail(error);

      parser.on('entry', (entry: ReadEntry) => {
        // A destroyed entry emits 'error'; a skipped one has no other listener.
        entry.on('error', () => undefined);
        if (failure) {
          entry.resume();
          return;
        }
        active.add(entry);
        entry.on('end', () => active.delete(entry));
        try {
          entries += 1;
          if (entries > MAX_ARCHIVE_ENTRIES) {
            throw new AppError('The backup contains too many files', { code: 'BACKUP_UNSAFE_ENTRY', statusCode: 400 });
          }
          const target = classifyBackupEntryPath(entry.path);
          if (entry.type === 'Directory') {
            entry.resume();
            return;
          }
          if (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'ContiguousFile') {
            throw new AppError(`The backup contains a ${entry.type} entry, which is never restored: ${entry.path.slice(0, 200)}`, {
              code: 'BACKUP_UNSAFE_ENTRY',
              statusCode: 400,
            });
          }
          let handled: Promise<void>;
          if (target.kind === 'manifest') handled = handlers.onManifest(entry);
          else if (target.kind === 'data') handled = handlers.onData(entry);
          else if (target.segments.length === 0) {
            throw new AppError(`The backup contains a file where a folder belongs: ${entry.path.slice(0, 200)}`, {
              code: 'BACKUP_UNSAFE_ENTRY',
              statusCode: 400,
            });
          } else handled = handlers.onFile(entry, target);
          pending.push(handled.catch(fail));
        } catch (error) {
          entry.resume();
          fail(error);
        }
      });
      parser.on('error', fail);
      parser.on('end', () => finish(null));
      source.on('error', fail);
      if (decrypt) {
        decrypt.on('error', fail);
        source.pipe(decrypt).pipe(parser as unknown as Writable);
      } else {
        source.pipe(parser as unknown as Writable);
      }
    });
  }

  /** Decides which session (if any) an archive file belongs to. */
  function sessionOf(target: Extract<BackupEntryTarget, { kind: 'file' }>, sessionFolders: Map<string, string>): string | null {
    const [first, second] = target.segments;
    if (target.area === 'projects') {
      if (target.segments.length === 2 && second.endsWith('.jsonl')) {
        const sessionId = second.slice(0, -'.jsonl'.length);
        return sessionFolders.get(sessionId) === first ? sessionId : null;
      }
      if (target.segments.length >= 3 && sessionFolders.get(second) === first) return second;
      return null;
    }
    if (target.area === 'fileHistory') return sessionFolders.has(first) ? first : null;
    if (target.area === 'todos') {
      const sessionId = todoSessionId(first);
      return sessionId && sessionFolders.has(sessionId) ? sessionId : null;
    }
    return null;
  }

  function destinationOf(target: Extract<BackupEntryTarget, { kind: 'file' }>): string {
    const root = areaRoots[target.area];
    const destination = path.join(root, ...target.segments);
    const relative = path.relative(root, destination);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError('The backup contains an entry outside its folder', { code: 'BACKUP_UNSAFE_ENTRY', statusCode: 400 });
    }
    return destination;
  }

  /** Creates the parent folders of `destination` without ever passing through a link or a file. */
  async function prepareParent(target: Extract<BackupEntryTarget, { kind: 'file' }>): Promise<void> {
    let current = areaRoots[target.area];
    await mkdir(current, { recursive: true, mode: 0o700 });
    for (const segment of target.segments.slice(0, -1)) {
      current = path.join(current, segment);
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
      const stats = await lstat(current);
      if (!stats.isDirectory()) {
        throw new AppError(`${current} is not a folder, so the backup cannot be restored there`, {
          code: 'BACKUP_UNSAFE_ENTRY',
          statusCode: 400,
        });
      }
    }
  }

  /**
   * Writes one entry to a file that does not exist yet. The content goes to a
   * temporary name first and is then hard-linked into place, which fails
   * instead of replacing anything that appeared in the meantime.
   */
  async function writeNewFile(entry: ReadEntry, destination: string, mode = 0o600, transform: Transform | null = null): Promise<boolean> {
    if (await exists(destination)) {
      entry.resume();
      return false;
    }
    const temporary = path.join(path.dirname(destination), `.${randomBytes(6).toString('hex')}${RESTORE_TEMP_SUFFIX}`);
    try {
      await writeEntryTo(entry, temporary, mode, transform);
      try {
        await link(temporary, destination);
      } catch (error) {
        if (errorCode(error) === 'EEXIST') return false;
        if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS', 'EOPNOTSUPP'].includes(errorCode(error) ?? '')) throw error;
        // Filesystems without hard links: check, then rename.
        if (await exists(destination)) return false;
        await rename(temporary, destination);
      }
      if (entry.mtime instanceof Date) {
        await utimes(destination, entry.mtime, entry.mtime).catch(() => undefined);
      }
      return true;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function scanArchive(job: ImportJob): Promise<void> {
    let manifest: Record<string, unknown> | null = null;
    let snapshot: BackupDatabaseSnapshot | null = null;
    const files: ScannedFile[] = [];
    const sessionFolders = new Map<string, string>();
    const sessionPaths = new Map<string, string | null>();

    await readArchive(job, {
      async onManifest(entry) {
        try {
          manifest = JSON.parse((await collectEntry(entry, MAX_MANIFEST_BYTES)).toString('utf8')) as Record<string, unknown>;
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError('This is not a ClaudeWeb backup file', { code: 'BACKUP_FORMAT_UNKNOWN', statusCode: 400 });
        }
      },
      async onData(entry) {
        try {
          snapshot = parseSnapshot(JSON.parse((await collectEntry(entry, MAX_DATA_BYTES)).toString('utf8')));
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError('The backup file is damaged or incomplete', { code: 'BACKUP_CORRUPTED', statusCode: 400 });
        }
      },
      async onFile(entry, target) {
        files.push({ area: target.area, segments: target.segments, size: entry.size ?? 0 });
        const [folder, name] = target.segments;
        if (target.area === 'projects' && target.segments.length === 2 && name.endsWith('.jsonl') && name.length > '.jsonl'.length) {
          const sessionId = name.slice(0, -'.jsonl'.length);
          if (!sessionFolders.has(sessionId)) {
            sessionFolders.set(sessionId, folder);
            sessionPaths.set(sessionId, transcriptWorkingDirectory(await collectEntryHead(entry, TRANSCRIPT_HEAD_BYTES)));
            return;
          }
        }
        entry.resume();
      },
    });

    const checkedManifest = manifest as Record<string, unknown> | null;
    if (!checkedManifest || (checkedManifest.format !== BACKUP_FORMAT_NAME && checkedManifest.format !== LEGACY_BACKUP_FORMAT_NAME)) {
      throw new AppError('This is not a ClaudeWeb backup file', { code: 'BACKUP_FORMAT_UNKNOWN', statusCode: 400 });
    }
    if (checkedManifest.version !== BACKUP_FORMAT_VERSION) {
      throw new AppError('This backup was made by a newer version', { code: 'BACKUP_VERSION_UNSUPPORTED', statusCode: 400 });
    }
    const checkedSnapshot: BackupDatabaseSnapshot = snapshot ?? parseSnapshot({});
    const relocation = relocationFor(checkedManifest.sourceHome, dependencies.homeDirectory);
    const relocatedSnapshot = relocateSnapshot(relocation, checkedSnapshot);

    // Which sessions this account already has, on disk or in its index.
    const known = dependencies.database.findKnownProviderSessionIds([...sessionFolders.keys()]);
    const existingSessions = new Set<string>();
    for (const [sessionId, folder] of sessionFolders) {
      if (known.has(sessionId) || await exists(path.join(areaRoots.projects, relocateFolder(relocation, folder), `${sessionId}.jsonl`))) {
        existingSessions.add(sessionId);
      }
    }

    // Original project path per transcript folder: the path most of its sessions ran in,
    // else a project row whose path Claude would store in this folder.
    const folderPaths = new Map<string, string | null>();
    const folderVotes = new Map<string, Map<string, number>>();
    for (const [sessionId, folder] of sessionFolders) {
      const cwd = sessionPaths.get(sessionId);
      if (!cwd) continue;
      const votes = folderVotes.get(folder) ?? new Map<string, number>();
      votes.set(cwd, (votes.get(cwd) ?? 0) + 1);
      folderVotes.set(folder, votes);
    }
    const projectsByFolder = new Map(checkedSnapshot.projects.map((project) => [claudeProjectFolderName(project.projectPath), project]));

    const projects = new Map<string, BackupPreviewProject>();
    const projectOf = (folder: string): BackupPreviewProject => {
      let project = projects.get(folder);
      if (!project) {
        const votes = folderVotes.get(folder);
        const voted = votes ? [...votes.entries()].sort((left, right) => right[1] - left[1])[0][0] : null;
        const projectPath = voted ?? projectsByFolder.get(folder)?.projectPath ?? null;
        const placedPath = relocatePath(relocation, projectPath);
        folderPaths.set(folder, placedPath);
        const row = projectPath ? checkedSnapshot.projects.find((candidate) => candidate.projectPath === projectPath) : undefined;
        project = {
          id: folder,
          name: row?.customProjectName?.trim() || (placedPath ? path.basename(placedPath) : '') || folder,
          path: placedPath,
          pathExists: false,
          sessionCount: 0,
          existingSessionCount: 0,
          newBytes: 0,
          fileCount: 0,
          fileBytes: 0,
        };
        projects.set(folder, project);
      }
      return project;
    };

    for (const [sessionId, folder] of sessionFolders) {
      const project = projectOf(folder);
      project.sessionCount += 1;
      if (existingSessions.has(sessionId)) project.existingSessionCount += 1;
    }

    // Project folders included at export, each shown with the project it belongs to.
    const workspaceDirs: Array<{ dir: string; projectId: string }> = [];
    for (const dir of manifestProjectFiles(checkedManifest.projectFiles)) {
      const placed = path.join(areaRoots.workspace, ...dir.split('/'));
      let project = [...projects.values()].find((candidate) => candidate.path === placed);
      if (!project) {
        const row = relocatedSnapshot.projects.find((candidate) => candidate.projectPath === placed);
        project = {
          id: `files:${dir}`,
          name: row?.customProjectName?.trim() || path.basename(placed),
          path: placed,
          pathExists: false,
          sessionCount: 0,
          existingSessionCount: 0,
          newBytes: 0,
          fileCount: 0,
          fileBytes: 0,
        };
        projects.set(project.id, project);
      }
      workspaceDirs.push({ dir, projectId: project.id });
    }
    workspaceDirs.sort((left, right) => right.dir.length - left.dir.length);

    let sharedNewBytes = 0;
    for (const file of files) {
      const target = { kind: 'file' as const, area: file.area, segments: file.segments };
      if (file.area === 'claudeUser') {
        let settings = projects.get(CLAUDE_USER_ID);
        if (!settings) {
          settings = {
            id: CLAUDE_USER_ID, name: 'Claude user settings', path: null, pathExists: true,
            sessionCount: 0, existingSessionCount: 0, newBytes: 0, fileCount: 0, fileBytes: 0,
          };
          projects.set(CLAUDE_USER_ID, settings);
        }
        if (await exists(destinationOf(target))) continue;
        settings.newBytes += file.size;
        settings.fileBytes += file.size;
        settings.fileCount += 1;
        continue;
      }
      if (file.area === 'workspace') {
        const owner = workspaceOwner(workspaceDirs, file.segments);
        if (!owner || await exists(destinationOf(target))) continue;
        const project = projects.get(owner.projectId) as BackupPreviewProject;
        project.newBytes += file.size;
        project.fileBytes += file.size;
        project.fileCount += 1;
        continue;
      }
      const sessionId = sessionOf(target, sessionFolders);
      if (sessionId && existingSessions.has(sessionId)) continue;
      const folder = sessionId ? sessionFolders.get(sessionId) as string : file.area === 'projects' ? file.segments[0] : null;
      if (!sessionId && await exists(destinationOf(relocatedTarget(relocation, target)))) continue;
      if (folder) projectOf(folder).newBytes += file.size;
      else sharedNewBytes += file.size;
    }

    for (const project of projects.values()) {
      if (project.id === CLAUDE_USER_ID) continue;
      project.pathExists = project.path ? await exists(project.path) : false;
    }

    job.plan = { snapshot: relocatedSnapshot, sessionFolders, existingSessions, folderPaths, relocation, workspaceDirs };
    job.preview = {
      createdAt: typeof checkedManifest.createdAt === 'string' ? checkedManifest.createdAt : null,
      sourceHome: typeof checkedManifest.sourceHome === 'string' ? checkedManifest.sourceHome : null,
      relocation: relocation ? { from: relocation.from, to: relocation.to } : null,
      plugins: (() => {
        const installed = new Set((dependencies.plugins?.list() ?? []).map((plugin) => plugin.name));
        return manifestPlugins(checkedManifest.plugins).map((plugin) => ({ ...plugin, installed: installed.has(plugin.name) }));
      })(),
      encrypted: job.format === 'encrypted',
      projects: [...projects.values()].sort((left, right) => left.name.localeCompare(right.name)),
      sharedNewBytes,
      freeBytes: await freeBytesNear(dependencies.claudeHome),
    };
  }

  async function runPreview(job: ImportJob, password: string | null): Promise<void> {
    const handle = await open(job.filePath, 'r');
    let head: Buffer;
    try {
      head = Buffer.alloc(ENCRYPTED_HEADER_BYTES);
      const { bytesRead } = await handle.read(head, 0, ENCRYPTED_HEADER_BYTES, 0);
      head = head.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }

    const format = detectBackupFormat(head);
    if (format === 'unknown') {
      throw new AppError('This is not a ClaudeWeb backup file', { code: 'BACKUP_FORMAT_UNKNOWN', statusCode: 400 });
    }
    job.format = format;
    if (format === 'encrypted' && !job.encryption) {
      const header = parseEncryptedHeader(head);
      if (!password) {
        job.state = 'password';
        job.error = { code: 'BACKUP_PASSWORD_REQUIRED', message: 'This backup is protected with a password' };
        return;
      }
      job.encryption = { header, key: await deriveBackupKey(password, header) };
    }

    try {
      await scanArchive(job);
    } catch (error) {
      if (error instanceof AppError && error.code === 'BACKUP_PASSWORD_WRONG') {
        job.encryption = null;
        job.state = 'password';
        job.error = { code: error.code, message: error.message };
        return;
      }
      throw error;
    }
    job.state = 'ready';
    job.error = null;
  }

  async function runImport(job: ImportJob, selectedFolders: Set<string>): Promise<void> {
    const plan = job.plan as ImportPlan;
    const restored = new Map<string, string>();
    let skippedExistingSessions = 0;
    let restoredFiles = 0;
    let skippedExistingFiles = 0;

    await readArchive(job, {
      async onManifest(entry) { entry.resume(); },
      async onData(entry) { entry.resume(); },
      async onFile(entry, target) {
        if (target.area === 'claudeUser') {
          const settingsFile = target.segments.length === 1 && target.segments[0] === 'settings.json';
          // A file only at a listed file name or inside a listed folder.
          const allowed = target.segments.length === 1
            ? (CLAUDE_USER_FILES as readonly string[]).includes(target.segments[0])
            : target.segments.length >= 2;
          if (!selectedFolders.has(CLAUDE_USER_ID) || !allowed) {
            entry.resume();
            return;
          }
          await prepareParent(target);
          const mode = settingsFile ? 0o600 : typeof entry.mode === 'number' ? (entry.mode & 0o755) | 0o600 : 0o600;
          const transform = settingsFile && plan.relocation ? new JsonRelocation(plan.relocation) : null;
          if (await writeNewFile(entry, destinationOf(target), mode, transform)) restoredFiles += 1;
          else skippedExistingFiles += 1;
          return;
        }
        if (target.area === 'workspace') {
          const owner = workspaceOwner(plan.workspaceDirs, target.segments);
          if (!owner || !selectedFolders.has(owner.projectId)) {
            entry.resume();
            return;
          }
          await prepareParent(target);
          // Kept: read and execute bits for the owner and others; never set-id bits.
          const mode = typeof entry.mode === 'number' ? (entry.mode & 0o755) | 0o600 : 0o644;
          if (await writeNewFile(entry, destinationOf(target), mode)) restoredFiles += 1;
          else skippedExistingFiles += 1;
          return;
        }
        const sessionId = sessionOf(target, plan.sessionFolders);
        const folder = sessionId ? plan.sessionFolders.get(sessionId) as string : target.area === 'projects' ? target.segments[0] : null;
        if (folder && !selectedFolders.has(folder)) {
          entry.resume();
          return;
        }
        if (sessionId && plan.existingSessions.has(sessionId)) {
          entry.resume();
          return;
        }
        const placed = relocatedTarget(plan.relocation, target);
        const destination = destinationOf(placed);
        await prepareParent(placed);
        const transcript = plan.relocation && target.area === 'projects' && target.segments[target.segments.length - 1].endsWith('.jsonl');
        if (await writeNewFile(entry, destination, 0o600, transcript ? new TranscriptRelocation(plan.relocation as Relocation) : null)) {
          restoredFiles += 1;
          if (sessionId && target.area === 'projects' && target.segments.length === 2) {
            restored.set(sessionId, destination);
          }
        } else {
          skippedExistingFiles += 1;
        }
      },
    });

    for (const sessionId of plan.existingSessions) {
      if (selectedFolders.has(plan.sessionFolders.get(sessionId) as string)) skippedExistingSessions += 1;
    }

    const projectPaths = new Set<string>();
    for (const project of job.preview?.projects ?? []) {
      if (selectedFolders.has(project.id) && project.path) projectPaths.add(project.path);
    }
    const database = dependencies.database.mergeSnapshot(plan.snapshot, {
      userId: job.userId,
      projectPaths,
      restoredSessions: restored,
      now: now(),
    });

    for (const transcript of restored.values()) {
      try {
        await dependencies.reindexTranscript(transcript);
      } catch (error) {
        logger.error(`[Backup] Could not index restored transcript ${transcript}`, error);
      }
    }
    const restoredRows = plan.snapshot.sessions.filter((session) => restored.has(session.providerSessionId));
    dependencies.database.restoreSessionFlags(restoredRows);

    const appIds = new Map(restoredRows.map((session) => [session.providerSessionId, session.sessionId]));
    await dependencies.announceSessions([...restored.keys()].map((sessionId) => appIds.get(sessionId) ?? sessionId))
      .catch((error) => logger.error('[Backup] Could not announce restored sessions', error));

    job.result = {
      restoredSessions: restored.size,
      skippedExistingSessions,
      restoredFiles,
      skippedExistingFiles,
      database,
    };
    job.state = 'done';
    job.error = null;
    job.encryption = null;
    await rm(job.filePath, { force: true });
  }

  async function cleanupStaleImports(): Promise<void> {
    const cutoff = Date.now() - STALE_IMPORT_MS;
    for (const job of [...imports.values()]) {
      if (job.touchedAt < cutoff && job.state !== 'reading' && job.state !== 'importing') await discardJob(job);
    }
    let names: string[];
    try {
      names = await readdir(dependencies.uploadsDirectory);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith(UPLOAD_SUFFIX) || imports.has(name.slice(0, -UPLOAD_SUFFIX.length))) continue;
      const filePath = path.join(dependencies.uploadsDirectory, name);
      try {
        if ((await stat(filePath)).mtimeMs < cutoff) await rm(filePath, { force: true });
      } catch (error) {
        if (!isMissing(error)) logger.error(`[Backup] Could not remove stale upload ${filePath}`, error);
      }
    }
  }

  function runInBackground(job: ImportJob, task: Promise<void>): void {
    void task.catch((error: unknown) => {
      job.state = 'failed';
      job.error = toPublicError(error);
      if (!(error instanceof AppError)) logger.error('[Backup] Import step failed', error);
    });
  }

  // ---------------------------------------------------------------- public API

  return {
    /** Reserves a one-time download for the given user. The password, if any, never appears in a URL. */
    async prepareExport(userId: number, password: unknown, projectFiles?: unknown): Promise<{ downloadId: string; fileName: string }> {
      const checkedPassword = validatePassword(password);
      let chosen: string[] = [];
      if (projectFiles !== undefined && projectFiles !== null) {
        const available = new Map((await projectFolders(userId)).map((folder) => [folder.path, folder.relative]));
        if (!Array.isArray(projectFiles) || projectFiles.length > MAX_PROJECT_FOLDERS
          || !projectFiles.every((value) => typeof value === 'string' && available.has(value))) {
          throw new AppError('Choose project folders from the list', { code: 'BACKUP_SELECTION_INVALID', statusCode: 400 });
        }
        // A folder inside another chosen one is already included with it.
        const relatives = [...new Set(projectFiles.map((value) => available.get(value as string) as string))].sort();
        chosen = relatives.filter((relative) => !relatives.some((other) => other !== relative && relative.startsWith(other + '/')));
      }
      const current = Date.now();
      for (const [id, ticket] of exportTickets) if (ticket.expiresAt <= current) exportTickets.delete(id);
      const downloadId = randomBytes(24).toString('base64url');
      const fileName = `claude-backup-${now().toISOString().slice(0, 10)}.tar.gz${checkedPassword ? '.enc' : ''}`;
      exportTickets.set(downloadId, { userId, password: checkedPassword, fileName, expiresAt: current + EXPORT_TICKET_TTL_MS, projectFiles: chosen });
      return { downloadId, fileName };
    },

    /** Project folders that can be added to a backup, for the export section of the settings page. */
    async listProjectFolders(userId: number): Promise<Array<{ path: string; name: string }>> {
      return (await projectFolders(userId)).map(({ path: folderPath, name }) => ({ path: folderPath, name }));
    },

    /** Claims a download reserved by `prepareExport`. Each id works once and only for two minutes. */
    takeExportTicket(downloadId: string): ExportTicket {
      const ticket = exportTickets.get(downloadId);
      exportTickets.delete(downloadId);
      if (!ticket || ticket.expiresAt <= Date.now()) {
        throw new AppError('This download link has expired. Start the export again.', {
          code: 'BACKUP_EXPORT_NOT_FOUND',
          statusCode: 404,
        });
      }
      return ticket;
    },

    /** Streams the archive while it is being built, so even a large backup starts downloading at once. */
    async writeExport(ticket: ExportTicket, destination: Writable): Promise<void> {
      const source = Readable.from(archiveBytes(ticket), { objectMode: false });
      const gzip = createGzip({ level: 6 });
      if (!ticket.password) {
        await pipeline(source, gzip, destination);
        return;
      }
      const header = createEncryptedHeader();
      const key = await deriveBackupKey(ticket.password, header);
      await pipeline(source, gzip, new BackupEncryptStream(key, header), destination);
    },

    /** Starts an upload of `size` bytes after checking that the disk can hold it. */
    async createImport(userId: number, input: { size?: unknown }): Promise<{ importId: string; chunkSize: number }> {
      const size = input.size;
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
        throw new AppError('The backup file size is not valid', { code: 'BACKUP_SIZE_INVALID', statusCode: 400 });
      }
      await mkdir(dependencies.uploadsDirectory, { recursive: true, mode: 0o700 });
      await cleanupStaleImports();
      for (const job of [...imports.values()]) {
        if (job.userId === userId && job.state !== 'reading' && job.state !== 'importing') await discardJob(job);
      }
      const freeBytes = await freeBytesNear(dependencies.uploadsDirectory);
      if (freeBytes < size + DISK_RESERVE_BYTES) throw diskFull(size + DISK_RESERVE_BYTES, freeBytes);

      const importId = randomBytes(16).toString('hex');
      const filePath = path.join(dependencies.uploadsDirectory, `${importId}${UPLOAD_SUFFIX}`);
      const handle = await open(filePath, 'wx', 0o600);
      await handle.close();
      imports.set(importId, {
        id: importId,
        userId,
        filePath,
        size,
        received: 0,
        state: 'uploading',
        error: null,
        format: null,
        encryption: null,
        plan: null,
        preview: null,
        result: null,
        progress: null,
        abort: null,
        touchedAt: Date.now(),
      });
      return { importId, chunkSize: BACKUP_CHUNK_BYTES };
    },

    /** Stores one piece. Pieces arrive in order; resending the last one is allowed. */
    async writeImportChunk(userId: number, importId: string, index: number, body: unknown): Promise<{ received: number }> {
      const job = findJob(userId, importId);
      if (job.state !== 'uploading') throw wrongState();
      const offset = index * BACKUP_CHUNK_BYTES;
      const expected = Math.min(BACKUP_CHUNK_BYTES, job.size - offset);
      if (!Number.isSafeInteger(index) || index < 0 || offset >= job.size || !Buffer.isBuffer(body) || body.length !== expected) {
        throw new AppError('This piece of the upload is not valid', { code: 'BACKUP_CHUNK_INVALID', statusCode: 400 });
      }
      if (offset > job.received) {
        throw new AppError('A piece of the upload is missing', { code: 'BACKUP_CHUNK_OUT_OF_ORDER', statusCode: 409 });
      }
      const handle = await open(job.filePath, 'r+');
      try {
        await handle.write(body, 0, body.length, offset);
      } finally {
        await handle.close();
      }
      job.received = Math.max(job.received, offset + body.length);
      if (job.received === job.size) job.state = 'uploaded';
      return { received: job.received };
    },

    /** Current state of an upload, polled by the settings page. */
    getImport(userId: number, importId: string) {
      return statusOf(findJob(userId, importId));
    },

    /** Reads the uploaded archive in the background and builds the preview. */
    startPreview(userId: number, importId: string, password: unknown) {
      const job = findJob(userId, importId);
      const retryable = job.state === 'uploaded' || job.state === 'password' || (job.state === 'failed' && job.received === job.size && !job.result);
      if (!retryable) throw wrongState();
      const checkedPassword = typeof password === 'string' && password.length > 0 && password.length <= BACKUP_PASSWORD_MAX_LENGTH ? password : null;
      job.state = 'reading';
      job.error = null;
      job.preview = null;
      job.plan = null;
      runInBackground(job, runPreview(job, checkedPassword));
      return statusOf(job);
    },

    /** Restores the selected projects in the background after checking free space. */
    async startApply(userId: number, importId: string, projectIds: unknown) {
      const job = findJob(userId, importId);
      if (job.state !== 'ready' || !job.preview || !job.plan) throw wrongState();
      const known = new Set(job.preview.projects.map((project) => project.id));
      if (!Array.isArray(projectIds) || !projectIds.every((id) => typeof id === 'string' && known.has(id))) {
        throw new AppError('Choose projects from the preview', { code: 'BACKUP_SELECTION_INVALID', statusCode: 400 });
      }
      const selected = new Set(projectIds as string[]);
      const requiredBytes = job.preview.projects
        .filter((project) => selected.has(project.id))
        .reduce((sum, project) => sum + project.newBytes, job.preview.sharedNewBytes) + DISK_RESERVE_BYTES;
      const freeBytes = await freeBytesNear(dependencies.claudeHome);
      if (freeBytes < requiredBytes) throw diskFull(requiredBytes, freeBytes);

      job.state = 'importing';
      job.error = null;
      runInBackground(job, runImport(job, selected));
      return statusOf(job);
    },

    /** Drops an upload and its file. An import that is already writing files finishes first. */
    async cancelImport(userId: number, importId: string): Promise<{ cancelled: true }> {
      const job = findJob(userId, importId);
      if (job.state === 'importing') throw wrongState();
      job.abort?.(new AppError('Cancelled', { code: 'BACKUP_CANCELLED', statusCode: 409 }));
      await discardJob(job);
      return { cancelled: true };
    },

    /** Removes uploads nobody touched for a day, including ones left by an earlier server run. */
    cleanupStaleImports,
  };
}
