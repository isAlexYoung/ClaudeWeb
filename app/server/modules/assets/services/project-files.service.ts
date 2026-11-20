import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveAttachmentAssetFile } from '@/modules/assets/services/image-assets.service.js';
import { uploadedFilesDb, type UploadedFileRow } from '@/modules/database/index.js';
import { getGlobalImageAssetsDir, toPosixPath } from '@/shared/image-attachments.js';
import { AppError } from '@/shared/utils.js';

/**
 * The project File management page: the files uploaded for one project, with
 * download and delete. Only names recorded in `uploaded_files` are reachable,
 * and they always resolve inside `~/.claudeweb/assets`.
 */

type ProjectFile = {
  storedName: string;
  name: string;
  path: string;
  size: number;
  mimeType: string | null;
  sessionId: string | null;
  uploadedAt: string;
  /** False when the file was removed from the disk outside ClaudeWeb. */
  exists: boolean;
};

const notFound = () => new AppError('This file is not recorded.', { code: 'PROJECT_FILE_NOT_FOUND', statusCode: 404 });

/** SQLite stores `YYYY-MM-DD HH:MM:SS` in UTC; the page wants an ISO time. */
function toIsoTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return `${value.replace(' ', 'T')}Z`;
  return value;
}

function toProjectFile(row: UploadedFileRow, assetsDir: string): ProjectFile {
  const full = path.join(assetsDir, row.stored_name);
  return {
    storedName: row.stored_name,
    name: row.original_name,
    path: toPosixPath(full),
    size: row.size,
    mimeType: row.mime_type,
    sessionId: row.session_id,
    uploadedAt: toIsoTime(row.created_at),
    exists: fsSync.existsSync(full),
  };
}

function resolveRecorded(storedName: string): { row: UploadedFileRow; file: string } {
  const file = resolveAttachmentAssetFile(storedName);
  const row = file ? uploadedFilesDb.get(storedName) : null;
  if (!file || !row) throw notFound();
  return { row, file };
}

/** `attachment` header carrying the original name, also for non-ASCII names. */
export function contentDispositionFor(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export const projectFilesService = {
  list(projectPath: unknown): ProjectFile[] {
    if (typeof projectPath !== 'string' || !projectPath.trim()) {
      throw new AppError('A project path is required.', { code: 'PROJECT_PATH_REQUIRED', statusCode: 400 });
    }
    const assetsDir = getGlobalImageAssetsDir();
    return uploadedFilesDb.listByProject(projectPath.trim()).map((row) => toProjectFile(row, assetsDir));
  },

  async open(storedName: string): Promise<{ name: string; size: number; mimeType: string; stream: fsSync.ReadStream }> {
    const { row, file } = resolveRecorded(storedName);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) {
      throw new AppError('The file is no longer on the server.', { code: 'PROJECT_FILE_MISSING', statusCode: 410 });
    }
    return {
      name: row.original_name,
      size: stat.size,
      mimeType: row.mime_type || 'application/octet-stream',
      stream: fsSync.createReadStream(file),
    };
  },

  /** Removes the file from the disk and from the list. A file already gone is not an error. */
  async remove(storedName: string): Promise<{ deleted: true }> {
    const { file } = resolveRecorded(storedName);
    await fs.rm(file, { force: true });
    uploadedFilesDb.delete(storedName);
    return { deleted: true };
  },
};
