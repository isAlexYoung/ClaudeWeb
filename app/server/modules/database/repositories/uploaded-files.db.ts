import { getConnection } from '@/modules/database/connection.js';
import { normalizeProjectPath } from '@/shared/utils.js';

/**
 * One chat attachment stored in the global `~/.cloudcli/assets` folder, with
 * the project (and, once it was sent, the conversation) it belongs to. Read by
 * the project's File management page; written when an upload completes, when
 * a message carrying it is sent, and by the start-up index of older uploads.
 */
export type UploadedFileRow = {
  stored_name: string;
  original_name: string;
  mime_type: string | null;
  size: number;
  project_path: string | null;
  session_id: string | null;
  created_at: string;
};

type NewUploadedFile = {
  storedName: string;
  originalName: string;
  mimeType: string | null;
  size: number;
  projectPath: string | null;
  sessionId: string | null;
  /** ISO time; the database default (now) when absent. */
  createdAt?: string | null;
};

const COLUMNS = 'stored_name, original_name, mime_type, size, project_path, session_id, created_at';

const normalizeOptionalPath = (value: string | null): string | null => (value ? normalizeProjectPath(value) : null);

export const uploadedFilesDb = {
  /** Records an upload; a name already recorded keeps its row. */
  insert(file: NewUploadedFile): void {
    getConnection().prepare(
      `INSERT INTO uploaded_files (${COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(stored_name) DO NOTHING`,
    ).run(
      file.storedName,
      file.originalName,
      file.mimeType,
      file.size,
      normalizeOptionalPath(file.projectPath),
      file.sessionId,
      file.createdAt ?? null,
    );
  },

  /** Fills in the project and conversation of an upload that did not know them yet. */
  attachToSession(storedName: string, projectPath: string | null, sessionId: string | null): void {
    getConnection().prepare(
      `UPDATE uploaded_files
       SET project_path = COALESCE(project_path, ?), session_id = COALESCE(session_id, ?)
       WHERE stored_name = ?`,
    ).run(normalizeOptionalPath(projectPath), sessionId, storedName);
  },

  get(storedName: string): UploadedFileRow | null {
    return (getConnection().prepare(`SELECT ${COLUMNS} FROM uploaded_files WHERE stored_name = ?`)
      .get(storedName) as UploadedFileRow | undefined) ?? null;
  },

  /** A project's uploads, newest first. */
  listByProject(projectPath: string): UploadedFileRow[] {
    return getConnection().prepare(
      `SELECT ${COLUMNS} FROM uploaded_files WHERE project_path = ?
       ORDER BY julianday(created_at) DESC, stored_name DESC`,
    ).all(normalizeProjectPath(projectPath)) as UploadedFileRow[];
  },

  listAll(): UploadedFileRow[] {
    return getConnection().prepare(`SELECT ${COLUMNS} FROM uploaded_files ORDER BY stored_name`).all() as UploadedFileRow[];
  },

  knownStoredNames(): Set<string> {
    const rows = getConnection().prepare('SELECT stored_name FROM uploaded_files').all() as Array<{ stored_name: string }>;
    return new Set(rows.map((row) => row.stored_name));
  },

  delete(storedName: string): boolean {
    return getConnection().prepare('DELETE FROM uploaded_files WHERE stored_name = ?').run(storedName).changes > 0;
  },

  /** Every conversation with a transcript, for matching older uploads to the project that used them. */
  listTranscripts(): Array<{ session_id: string; project_path: string | null; jsonl_path: string }> {
    return getConnection().prepare(
      `SELECT session_id, project_path, jsonl_path FROM sessions WHERE jsonl_path IS NOT NULL AND jsonl_path <> ''`,
    ).all() as Array<{ session_id: string; project_path: string | null; jsonl_path: string }>;
  },
};
