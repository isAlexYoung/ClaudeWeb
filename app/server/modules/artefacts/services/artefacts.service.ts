import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { artefactsDb, sessionsDb } from '@/modules/database/index.js';
import type { ArtefactRow } from '@/modules/database/index.js';
import {
  MAX_SHEET_BYTES,
  blankSheetDocument,
  sheetEditingInstructions,
  validateSheetDocument,
} from '@/modules/artefacts/sheet-format.js';
import type { SheetDocument } from '@/modules/artefacts/sheet-format.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

/** One artefact as the Artefacts page lists it. */
export type ArtefactSummary = {
  id: string;
  kind: ArtefactRow['kind'];
  title: string;
  sessionId: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  openedAt: string;
};

/** One artefact as the editor opens it. `content` is null when the file is missing or not valid. */
export type ArtefactDetail = ArtefactSummary & {
  content: SheetDocument | null;
  contentError: string | null;
  revision: string;
};

/** What the editor polls while it is open. */
export type ArtefactState = {
  revision: string;
  running: boolean;
  sessionId: string | null;
  lastError: string | null;
};

const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 20_000;

let artefactRuntime: ProviderRuntimeGateway | null = null;
// Artefacts whose Claude turn is being dispatched or is running. Held from the
// request until runDetachedChatTurn settles, so a poll that lands before the
// run registers still reads it as running.
const pendingRuns = new Set<string>();
// The last run's failure per artefact, cleared when the next one starts.
const lastRunErrors = new Map<string, string>();

/** Where the files live: ~/Artefacts, inside the Chat workspace so Claude may edit them. */
export function getArtefactsDirectory(): string {
  return process.env.CLAUDEWEB_ARTEFACTS_DIR || path.join(os.homedir(), 'Artefacts');
}

/** The folder new artefact conversations run in: the Chat workspace. */
function getArtefactWorkspace(): string {
  return process.env.CLAUDEWEB_ARTEFACTS_WORKSPACE || os.homedir();
}

function toSummary(row: ArtefactRow): ArtefactSummary {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    sessionId: row.session_id,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openedAt: row.opened_at,
  };
}

function notFound(): AppError {
  return new AppError('The artefact was not found.', { code: 'ARTEFACT_NOT_FOUND', statusCode: 404 });
}

function requireRow(userId: number, id: string): ArtefactRow {
  const row = artefactsDb.get(userId, id);
  if (!row) throw notFound();
  return row;
}

/** Changes whenever the file does, whoever wrote it. */
export function readRevision(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${Math.round(stat.mtimeMs)}-${stat.size}`;
  } catch {
    return 'missing';
  }
}

function readTitle(value: unknown, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('A title is required.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return value.trim().slice(0, MAX_TITLE_LENGTH);
}

function writeDocument(filePath: string, document: SheetDocument): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(text) > MAX_SHEET_BYTES) {
    throw new AppError('The spreadsheet is larger than 5 MB.', { code: 'ARTEFACT_TOO_LARGE', statusCode: 413 });
  }
  // Written beside the file and renamed over it, so a reader never sees half of it.
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, filePath);
}

function readDocument(filePath: string): { content: SheetDocument | null; error: string | null } {
  let text: string;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_SHEET_BYTES) return { content: null, error: 'The file is larger than 5 MB.' };
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { content: null, error: 'The file no longer exists.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { content: null, error: 'The file is not valid JSON.' };
  }
  const problem = validateSheetDocument(parsed);
  return problem ? { content: null, error: problem } : { content: parsed as SheetDocument, error: null };
}

export const artefactsService = {
  list(userId: number): ArtefactSummary[] {
    return artefactsDb.list(userId).map(toSummary);
  },

  create(userId: number, body: Record<string, unknown>): ArtefactSummary {
    if (body.kind !== 'sheet') {
      throw new AppError('Only spreadsheets can be created.', { code: 'ARTEFACT_KIND_UNSUPPORTED', statusCode: 400 });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const filePath = path.join(getArtefactsDirectory(), `${id}.sheet.json`);
    writeDocument(filePath, blankSheetDocument());
    artefactsDb.insert({
      id,
      user_id: userId,
      kind: 'sheet',
      title: readTitle(body.title, 'Untitled'),
      file_path: filePath,
      created_at: now,
      updated_at: now,
      opened_at: now,
    });
    return toSummary(requireRow(userId, id));
  },

  /** Opening it counts as opening: the page sorts by when each was last opened. */
  open(userId: number, id: string): ArtefactDetail {
    requireRow(userId, id);
    artefactsDb.touchOpened(userId, id, new Date().toISOString());
    const row = requireRow(userId, id);
    const { content, error } = readDocument(row.file_path);
    return { ...toSummary(row), content, contentError: error, revision: readRevision(row.file_path) };
  },

  /**
   * Saves the editor's copy. `baseRevision` is the revision the editor last
   * loaded; when the file has changed since (Claude edited it), the save is
   * refused so the editor can load that version instead of overwriting it.
   */
  saveContent(userId: number, id: string, body: Record<string, unknown>): { revision: string } {
    const row = requireRow(userId, id);
    const problem = validateSheetDocument(body.content);
    if (problem) throw new AppError(problem, { code: 'ARTEFACT_INVALID_CONTENT', statusCode: 400 });
    if (typeof body.baseRevision !== 'string' || body.baseRevision !== readRevision(row.file_path)) {
      throw new AppError('The spreadsheet changed since it was loaded.', { code: 'ARTEFACT_CHANGED', statusCode: 409 });
    }
    if (pendingRuns.has(id)) {
      throw new AppError('Claude is editing this spreadsheet.', { code: 'ARTEFACT_BUSY', statusCode: 409 });
    }
    writeDocument(row.file_path, body.content as SheetDocument);
    artefactsDb.touchUpdated(userId, id, new Date().toISOString());
    return { revision: readRevision(row.file_path) };
  },

  update(userId: number, id: string, body: Record<string, unknown>): ArtefactSummary {
    requireRow(userId, id);
    const fields: { title?: string; pinned?: boolean } = {};
    if (body.title !== undefined) fields.title = readTitle(body.title);
    if (body.pinned !== undefined) fields.pinned = Boolean(body.pinned);
    artefactsDb.update(userId, id, fields, new Date().toISOString());
    return toSummary(requireRow(userId, id));
  },

  /** Removes the row and its file; the conversation stays, like any other. */
  remove(userId: number, id: string): void {
    const row = requireRow(userId, id);
    fs.rmSync(row.file_path, { force: true });
    artefactsDb.delete(userId, id);
    lastRunErrors.delete(id);
  },

  state(userId: number, id: string): ArtefactState {
    const row = requireRow(userId, id);
    const sessionRunning = row.session_id ? chatRunRegistry.getRun(row.session_id)?.status === 'running' : false;
    return {
      revision: readRevision(row.file_path),
      running: pendingRuns.has(id) || sessionRunning,
      sessionId: row.session_id,
      lastError: lastRunErrors.get(id) ?? null,
    };
  },

  /**
   * Asks Claude to change the spreadsheet. The first request creates the
   * artefact's conversation in the Chat workspace; later ones continue it, so
   * Claude keeps the context of earlier requests. Returns once the run is on
   * its way; the editor follows it through `state`.
   */
  sendMessage(
    userId: number,
    id: string,
    body: Record<string, unknown>,
    runtime: ProviderRuntimeGateway | null = artefactRuntime,
  ): { sessionId: string } {
    if (!runtime) throw new AppError('Chat runtime is unavailable.', { code: 'RUNTIME_UNAVAILABLE', statusCode: 503 });
    const row = requireRow(userId, id);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new AppError('A message is required.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new AppError('The message is too long.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    }
    if (this.state(userId, id).running) {
      throw new AppError('Claude is already editing this spreadsheet.', { code: 'ARTEFACT_BUSY', statusCode: 409 });
    }

    let sessionId = row.session_id && sessionsDb.getSessionById(row.session_id) ? row.session_id : null;
    if (!sessionId) {
      sessionId = randomUUID();
      const sessionTitle = typeof body.sessionTitle === 'string' && body.sessionTitle.trim()
        ? body.sessionTitle.trim().slice(0, MAX_TITLE_LENGTH)
        : row.title;
      sessionsDb.createAppSession(sessionId, 'claude', getArtefactWorkspace(), sessionTitle);
      artefactsDb.setSession(userId, id, sessionId);
    }

    pendingRuns.add(id);
    lastRunErrors.delete(id);
    const runSessionId = sessionId;
    void runDetachedChatTurn(
      {
        sessionId: runSessionId,
        userId,
        content: text,
        options: {
          // Nobody approves anything mid-run: file edits are allowed, anything
          // else that would wait for an answer is refused.
          permissionMode: 'acceptEdits',
          toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: false },
          unattended: true,
          sessionSummary: row.title,
        },
        systemPromptAppend: sheetEditingInstructions(row.file_path, row.title),
      },
      { runtime },
    ).then((result) => {
      if (!result.started || result.error) lastRunErrors.set(id, result.error ?? 'The run did not start.');
    }).catch((error: unknown) => {
      lastRunErrors.set(id, error instanceof Error ? error.message : String(error));
    }).finally(() => {
      pendingRuns.delete(id);
      if (artefactsDb.get(userId, id)) artefactsDb.touchUpdated(userId, id, new Date().toISOString());
    });
    return { sessionId: runSessionId };
  },
};

/** Started with the server: gives artefact runs the provider runtime scheduled tasks use. */
export function initializeArtefacts(runtime: ProviderRuntimeGateway): void {
  artefactRuntime = runtime;
}
