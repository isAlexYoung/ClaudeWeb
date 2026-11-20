import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { uploadedFilesDb } from '@/modules/database/index.js';
import { getGlobalImageAssetsDir, toPosixPath } from '@/shared/image-attachments.js';
import { AppError } from '@/shared/utils.js';

/**
 * Chat attachments of up to 256 MB, sent in 8 MB pieces.
 *
 * ClaudeWeb is reached through a Cloudflare Tunnel, which refuses any single
 * request over 100 MB, so a large file cannot arrive in one POST. Pieces are
 * written in order into a temporary file outside the assets folder (so a
 * backup never picks up half an upload); the finished file is then moved into
 * `~/.claudeweb/assets` and recorded with the project it was uploaded for.
 */

export const ATTACHMENT_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024;
// Free space kept on the disk after an upload, so a big file cannot fill it:
// a tenth of the disk, at most 512 MB. WebDesktop keeps the guest home on its
// own disk of about 1 GB, where a fixed 512 MB could never be left free and
// every upload, however small, was refused.
const MAX_DISK_RESERVE_BYTES = 512 * 1024 * 1024;
const DISK_RESERVE_SHARE = 0.1;
// An upload nobody has written to for this long is dropped with its temporary file.
const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;
const MAX_OPEN_UPLOADS = 20;

type Upload = {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  projectPath: string | null;
  sessionId: string | null;
  tempPath: string;
  handle: FileHandle;
  received: number;
  touchedAt: number;
};

type StoredAttachmentRecord = { name: string; path: string; size: number; mimeType: string };

const uploads = new Map<string, Upload>();

const badRequest = (message: string, code: string, statusCode = 400) => new AppError(message, { code, statusCode });

export function getUploadTempDir(): string {
  return path.join(os.homedir(), '.claudeweb', 'uploads-tmp');
}

/** The name a file is stored under: unique, and safe as a single path segment. */
export function storedNameFor(originalName: string, now = Date.now()): string {
  const sanitized = originalName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/^\.+/, '_') || 'file';
  // Leave room for the unique prefix within the filesystem's 255-byte name limit.
  const extension = path.extname(sanitized).slice(0, 16);
  const shortName = sanitized.length > 220 ? sanitized.slice(0, 220 - extension.length) + extension : sanitized;
  return `${now}-${Math.round(Math.random() * 1e9)}-${shortName}`;
}

async function dropUpload(upload: Upload): Promise<void> {
  uploads.delete(upload.id);
  await upload.handle.close().catch(() => undefined);
  await fs.rm(upload.tempPath, { force: true }).catch(() => undefined);
}

/** Drops uploads left unfinished, in memory and on disk (also those from before a restart). */
async function sweepAbandoned(now = Date.now()): Promise<void> {
  for (const upload of [...uploads.values()]) {
    if (now - upload.touchedAt > ABANDONED_AFTER_MS) await dropUpload(upload);
  }
  const dir = getUploadTempDir();
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const open = new Set([...uploads.values()].map((upload) => path.basename(upload.tempPath)));
  for (const entry of entries) {
    if (open.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && now - stat.mtimeMs > ABANDONED_AFTER_MS) await fs.rm(full, { force: true }).catch(() => undefined);
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

/** Started by the server entrypoint; abandoned files expire even when no new upload arrives. */
export function initializeUploadCleanup(): void {
  if (cleanupTimer) return;
  const clean = () => void sweepAbandoned().catch((error: unknown) => {
    console.warn('[Uploads] Could not clean unfinished uploads:', error instanceof Error ? error.message : error);
  });
  clean();
  cleanupTimer = setInterval(clean, 5 * 60 * 1000);
  cleanupTimer.unref();
}

type DiskSpace = { available: number; total: number };

async function diskSpace(dir: string): Promise<DiskSpace | null> {
  try {
    const stats = await fs.statfs(dir);
    return { available: Number(stats.bavail) * Number(stats.bsize), total: Number(stats.blocks) * Number(stats.bsize) };
  } catch {
    return null;
  }
}

/** The free space an upload must leave on a disk of this size. */
export function diskReserveFor(totalBytes: number): number {
  return Math.min(MAX_DISK_RESERVE_BYTES, Math.floor(totalBytes * DISK_RESERVE_SHARE));
}

const formatMb = (bytes: number) => `${Math.max(0, Math.round(bytes / (1024 * 1024)))} MB`;

/**
 * Null when `needed` more bytes fit on the disk with its reserve left free;
 * otherwise the error, saying how much the server has and how much is needed.
 */
export function diskRoomError(space: DiskSpace | null, needed: number): AppError | null {
  if (!space) return null;
  const reserve = diskReserveFor(space.total);
  if (space.available - needed >= reserve) return null;
  return badRequest(
    `There is not enough free disk space on the server for this file: ${formatMb(space.available)} free, `
      + `${formatMb(needed + reserve)} needed (the file plus ${formatMb(reserve)} kept free).`,
    'UPLOAD_DISK_FULL',
    507,
  );
}

const readText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;

export const chunkedUploadService = {
  async create(input: unknown): Promise<{ uploadId: string; chunkSize: number }> {
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const name = readText(body.name, 255);
    const size = body.size;
    if (!name) throw badRequest('A file name is required.', 'UPLOAD_NAME_REQUIRED');
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
      throw badRequest('The file size is not valid.', 'UPLOAD_SIZE_INVALID');
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      throw badRequest(`Files can be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`, 'UPLOAD_TOO_LARGE', 413);
    }

    await sweepAbandoned();
    if (uploads.size >= MAX_OPEN_UPLOADS) {
      throw badRequest('Too many uploads are in progress. Try again when they finish.', 'UPLOAD_TOO_MANY', 429);
    }

    const dir = getUploadTempDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const reserved = [...uploads.values()].reduce((sum, upload) => sum + upload.size - upload.received, 0);
    const noRoom = diskRoomError(await diskSpace(dir), reserved + size);
    if (noRoom) throw noRoom;

    const id = randomUUID();
    const tempPath = path.join(dir, `${id}.part`);
    const handle = await fs.open(tempPath, 'w', 0o600);
    const projectPath = readText(body.projectPath, 4096);
    uploads.set(id, {
      id,
      name,
      mimeType: readText(body.mimeType, 255),
      size,
      projectPath: projectPath && path.isAbsolute(projectPath) ? projectPath : null,
      sessionId: readText(body.sessionId, 200),
      tempPath,
      handle,
      received: 0,
      touchedAt: Date.now(),
    });
    return { uploadId: id, chunkSize: ATTACHMENT_CHUNK_BYTES };
  },

  /**
   * Writes piece `index`. Pieces arrive in order; resending one already
   * written (a retry after a lost response) rewrites the same bytes.
   */
  async writeChunk(uploadId: string, index: number, body: unknown): Promise<{ received: number }> {
    const upload = uploads.get(uploadId);
    if (!upload) throw badRequest('This upload no longer exists.', 'UPLOAD_NOT_FOUND', 404);
    const offset = index * ATTACHMENT_CHUNK_BYTES;
    const expected = Math.min(ATTACHMENT_CHUNK_BYTES, upload.size - offset);
    if (!Number.isSafeInteger(index) || index < 0 || offset >= upload.size || !Buffer.isBuffer(body) || body.length !== expected) {
      throw badRequest('This piece of the upload is not valid.', 'UPLOAD_CHUNK_INVALID');
    }
    if (offset > upload.received) {
      throw badRequest('A piece of the upload is missing.', 'UPLOAD_CHUNK_OUT_OF_ORDER', 409);
    }
    // Other applications may have consumed disk space since this upload began.
    if (offset + body.length > upload.received) {
      const noRoom = diskRoomError(await diskSpace(getUploadTempDir()), body.length);
      if (noRoom) throw noRoom;
    }
    // A filesystem write may accept fewer bytes than requested.
    let written = 0;
    while (written < body.length) {
      const { bytesWritten } = await upload.handle.write(body, written, body.length - written, offset + written);
      if (bytesWritten === 0) throw badRequest('The server could not write this upload.', 'UPLOAD_WRITE_FAILED', 507);
      written += bytesWritten;
    }
    upload.received = Math.max(upload.received, offset + body.length);
    upload.touchedAt = Date.now();
    return { received: upload.received };
  },

  /** Moves the finished file into the assets folder, records it, and returns the attachment record. */
  async complete(uploadId: string): Promise<StoredAttachmentRecord> {
    const upload = uploads.get(uploadId);
    if (!upload) throw badRequest('This upload no longer exists.', 'UPLOAD_NOT_FOUND', 404);
    if (upload.received !== upload.size) {
      throw badRequest('The upload is not complete yet.', 'UPLOAD_INCOMPLETE', 409);
    }
    uploads.delete(uploadId);
    await upload.handle.close();

    const assetsDir = getGlobalImageAssetsDir();
    await fs.mkdir(assetsDir, { recursive: true });
    const storedName = storedNameFor(upload.name);
    const target = path.join(assetsDir, storedName);
    try {
      await fs.rename(upload.tempPath, target);
    } catch (error) {
      // Different file systems: copy, then remove the temporary file.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await fs.copyFile(upload.tempPath, target);
      await fs.rm(upload.tempPath, { force: true });
    }

    const mimeType = upload.mimeType || 'application/octet-stream';
    uploadedFilesDb.insert({
      storedName,
      originalName: upload.name,
      mimeType,
      size: upload.size,
      projectPath: upload.projectPath,
      sessionId: upload.sessionId,
    });
    return { name: upload.name, path: toPosixPath(target), size: upload.size, mimeType };
  },

  async cancel(uploadId: string): Promise<void> {
    const upload = uploads.get(uploadId);
    if (upload) await dropUpload(upload);
  },

  /** Tests only: forget every open upload. */
  async resetForTests(): Promise<void> {
    for (const upload of [...uploads.values()]) await dropUpload(upload);
  },
};
