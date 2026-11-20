import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import mime from 'mime-types';

import { uploadedFilesDb } from '@/modules/database/index.js';
import { getGlobalImageAssetsDir } from '@/shared/image-attachments.js';

/**
 * Lists uploads made before ClaudeWeb recorded them (or restored from a backup
 * without their records) on the File management page of the project that
 * used them. Conversation transcripts are searched for the stored file's
 * path; a file no conversation mentions is recorded without a project, so it
 * is not searched for again on the next start.
 */

// `<ms>-<random>-<sanitized original name>`, as both upload paths name files.
const STORED_NAME_PATTERN = /^(\d{12,14})-\d+-(.+)$/;
const ASSET_REFERENCE_PATTERN = /\.cloudcli[\\/]+assets[\\/]+([A-Za-z0-9._-]+)/g;
const ORIGINAL_NAME_PATTERN = /\.cloudcli[\\/]+assets[\\/]+([A-Za-z0-9._-]+) \(original name: ([^)\\"]+)\)/g;

type Match = { projectPath: string | null; sessionId: string; originalName?: string };

export function originalNameFromStoredName(storedName: string): string {
  return STORED_NAME_PATTERN.exec(storedName)?.[2] ?? storedName;
}

function uploadTimeFromStoredName(storedName: string, fallbackMs: number): string {
  const ms = Number(STORED_NAME_PATTERN.exec(storedName)?.[1]);
  const valid = Number.isFinite(ms) && ms > 1_000_000_000_000 && ms < 10_000_000_000_000;
  return new Date(valid ? ms : fallbackMs).toISOString();
}

/** Scans one transcript for references to the given stored names; the first conversation to use a file wins. */
async function scanTranscript(
  jsonlPath: string,
  wanted: Set<string>,
  found: Map<string, Match>,
  transcript: { project_path: string | null; session_id: string },
): Promise<void> {
  const stream = fsSync.createReadStream(jsonlPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes('.cloudcli')) continue;
      const names = new Map<string, string | undefined>();
      for (const match of line.matchAll(ASSET_REFERENCE_PATTERN)) names.set(match[1], undefined);
      for (const match of line.matchAll(ORIGINAL_NAME_PATTERN)) names.set(match[1], match[2].trim() || undefined);
      for (const [name, originalName] of names) {
        if (!wanted.has(name) || found.has(name)) continue;
        found.set(name, { projectPath: transcript.project_path, sessionId: transcript.session_id, originalName });
      }
      if (found.size === wanted.size) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Records every file in the assets folder that has no record yet. Returns how many were added. */
export async function indexOlderUploads(): Promise<number> {
  const assetsDir = getGlobalImageAssetsDir();
  const entries = await fs.readdir(assetsDir, { withFileTypes: true }).catch(() => []);
  const known = uploadedFilesDb.knownStoredNames();
  const unknown = new Set(entries.filter((entry) => entry.isFile() && !known.has(entry.name)).map((entry) => entry.name));
  if (unknown.size === 0) return 0;

  const found = new Map<string, Match>();
  for (const transcript of uploadedFilesDb.listTranscripts()) {
    if (found.size === unknown.size) break;
    const exists = await fs.access(transcript.jsonl_path).then(() => true, () => false);
    if (!exists) continue;
    await scanTranscript(transcript.jsonl_path, unknown, found, transcript).catch((error) => {
      console.warn(`[Uploads] Could not read transcript ${transcript.jsonl_path}:`, error instanceof Error ? error.message : error);
    });
  }

  let added = 0;
  for (const storedName of unknown) {
    const stat = await fs.stat(path.join(assetsDir, storedName)).catch(() => null);
    if (!stat) continue;
    const match = found.get(storedName);
    uploadedFilesDb.insert({
      storedName,
      originalName: match?.originalName ?? originalNameFromStoredName(storedName),
      mimeType: mime.lookup(storedName) || null,
      size: stat.size,
      projectPath: match?.projectPath ?? null,
      sessionId: match?.sessionId ?? null,
      createdAt: uploadTimeFromStoredName(storedName, stat.mtimeMs),
    });
    added += 1;
  }
  return added;
}
