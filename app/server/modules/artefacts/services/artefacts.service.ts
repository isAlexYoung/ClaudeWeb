import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { artefactsDb, sessionsDb } from '@/modules/database/index.js';
import type { ArtefactRow } from '@/modules/database/index.js';
import { getArtefactFormat, isEditableKind } from '@/modules/artefacts/formats.js';
import type { ArtefactFormat } from '@/modules/artefacts/formats.js';
import { broadcastSessionUpserted, chatRunRegistry, runDetachedChatTurn, setSessionTurnHook } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway, SessionTurnHookResult } from '@/modules/websocket/index.js';
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

/**
 * One artefact as the editor opens it. `content` is the kind's own content (a
 * spreadsheet or whiteboard object, a document's Markdown), or null when the
 * file is missing or not valid.
 */
export type ArtefactDetail = ArtefactSummary & {
  content: unknown;
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

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatOf(row: ArtefactRow): ArtefactFormat {
  if (!isEditableKind(row.kind)) {
    throw new AppError('This kind of artefact cannot be opened yet.', { code: 'ARTEFACT_KIND_UNSUPPORTED', statusCode: 400 });
  }
  return getArtefactFormat(row.kind);
}

function writeDocument(filePath: string, format: ArtefactFormat, content: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = format.serialize(content);
  if (Buffer.byteLength(text) > format.maxBytes) {
    throw new AppError(`The ${format.noun} is larger than ${megabytes(format.maxBytes)}.`, { code: 'ARTEFACT_TOO_LARGE', statusCode: 413 });
  }
  // Written beside the file and renamed over it, so a reader never sees half of it.
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, filePath);
}

function readDocument(filePath: string, format: ArtefactFormat): { content: unknown; error: string | null } {
  let text: string;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > format.maxBytes) return { content: null, error: `The file is larger than ${megabytes(format.maxBytes)}.` };
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { content: null, error: 'The file no longer exists.' };
  }
  return format.parse(text);
}

function ensureLinkedSession(userId: number, row: ArtefactRow, preferredTitle?: string): string {
  if (row.session_id && sessionsDb.getSessionById(row.session_id)) {
    return row.session_id;
  }
  const sessionId = randomUUID();
  const title = preferredTitle?.trim() ? preferredTitle.trim().slice(0, MAX_TITLE_LENGTH) : row.title;
  sessionsDb.createAppSession(sessionId, 'claude', getArtefactWorkspace(), title);
  artefactsDb.setSession(userId, row.id, sessionId);
  void broadcastSessionUpserted(sessionId).catch(() => {});
  return sessionId;
}

export const artefactsService = {
  list(userId: number): ArtefactSummary[] {
    return artefactsDb.list(userId).map(toSummary);
  },

  create(userId: number, body: Record<string, unknown>): ArtefactSummary {
    if (!isEditableKind(body.kind)) {
      throw new AppError('Only spreadsheets, documents and whiteboards can be created.', { code: 'ARTEFACT_KIND_UNSUPPORTED', statusCode: 400 });
    }
    const format = getArtefactFormat(body.kind);
    const id = randomUUID();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const title = readTitle(body.title, 'Untitled');
    const filePath = path.join(getArtefactsDirectory(), `${id}${format.extension}`);
    writeDocument(filePath, format, format.blank());
    sessionsDb.createAppSession(sessionId, 'claude', getArtefactWorkspace(), title);
    artefactsDb.insert({
      id,
      user_id: userId,
      kind: format.kind,
      title,
      file_path: filePath,
      session_id: sessionId,
      created_at: now,
      updated_at: now,
      opened_at: now,
    });
    void broadcastSessionUpserted(sessionId).catch(() => {});
    return toSummary(requireRow(userId, id));
  },

  /** Opening it counts as opening: the page sorts by when each was last opened. */
  open(userId: number, id: string): ArtefactDetail {
    const existing = requireRow(userId, id);
    ensureLinkedSession(userId, existing);
    artefactsDb.touchOpened(userId, id, new Date().toISOString());
    const row = requireRow(userId, id);
    const { content, error } = readDocument(row.file_path, formatOf(row));
    return { ...toSummary(row), content, contentError: error, revision: readRevision(row.file_path) };
  },

  /**
   * Saves the editor's copy. `baseRevision` is the revision the editor last
   * loaded; when the file has changed since (Claude edited it), the save is
   * refused so the editor can load that version instead of overwriting it.
   */
  saveContent(userId: number, id: string, body: Record<string, unknown>): { revision: string } {
    const row = requireRow(userId, id);
    const format = formatOf(row);
    const problem = format.validate(body.content);
    if (problem) throw new AppError(problem, { code: 'ARTEFACT_INVALID_CONTENT', statusCode: 400 });
    if (typeof body.baseRevision !== 'string' || body.baseRevision !== readRevision(row.file_path)) {
      throw new AppError(`The ${format.noun} changed since it was loaded.`, { code: 'ARTEFACT_CHANGED', statusCode: 409 });
    }
    if (pendingRuns.has(id)) {
      throw new AppError(`Claude is editing this ${format.noun}.`, { code: 'ARTEFACT_BUSY', statusCode: 409 });
    }
    writeDocument(row.file_path, format, body.content);
    artefactsDb.touchUpdated(userId, id, new Date().toISOString());
    return { revision: readRevision(row.file_path) };
  },

  update(userId: number, id: string, body: Record<string, unknown>): ArtefactSummary {
    const existing = requireRow(userId, id);
    const fields: { title?: string; pinned?: boolean } = {};
    if (body.title !== undefined) fields.title = readTitle(body.title);
    if (body.pinned !== undefined) fields.pinned = Boolean(body.pinned);
    artefactsDb.update(userId, id, fields, new Date().toISOString());
    if (fields.title !== undefined && existing.session_id && sessionsDb.getSessionById(existing.session_id)) {
      sessionsDb.updateSessionCustomName(existing.session_id, fields.title);
      void broadcastSessionUpserted(existing.session_id).catch(() => {});
    }
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
   * Asks Claude to change the artefact. The first request creates the
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
    const format = formatOf(row);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new AppError('A message is required.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new AppError('The message is too long.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    }
    if (this.state(userId, id).running) {
      throw new AppError(`Claude is already editing this ${format.noun}.`, { code: 'ARTEFACT_BUSY', statusCode: 409 });
    }

    const preferredTitle = typeof body.sessionTitle === 'string' && body.sessionTitle.trim()
      ? body.sessionTitle.trim()
      : undefined;
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
    const effort = typeof body.effort === 'string' && body.effort.trim() ? body.effort.trim() : undefined;
    const mcpEnabled = typeof body.mcpEnabled === 'boolean' ? body.mcpEnabled : undefined;
    const sessionId = ensureLinkedSession(userId, row, preferredTitle);

    pendingRuns.add(id);
    lastRunErrors.delete(id);
    const runSessionId = sessionId;
    void runDetachedChatTurn(
      {
        sessionId: runSessionId,
        userId,
        content: text,
        options: {
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...(mcpEnabled === undefined ? {} : { mcpEnabled }),
          // Nobody approves anything mid-run: file edits are allowed, anything
          // else that would wait for an answer is refused.
          permissionMode: 'acceptEdits',
          toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: false },
          unattended: true,
          sessionSummary: row.title,
        },
        systemPromptAppend: format.instructions(row.file_path, row.title),
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

/** Enriches interactive Chat turns inside an artefact's conversation with its editing format. */
export function resolveArtefactTurnContext(sessionId: string): SessionTurnHookResult | null {
  const row = artefactsDb.getBySessionId(sessionId);
  if (!row || !isEditableKind(row.kind)) return null;
  return {
    systemPromptAppend: getArtefactFormat(row.kind).instructions(row.file_path, row.title),
    onFinished: () => {
      if (artefactsDb.get(row.user_id, row.id)) {
        artefactsDb.touchUpdated(row.user_id, row.id, new Date().toISOString());
      }
    },
  };
}

/** Started with the server: gives artefact runs the provider runtime scheduled tasks use. */
export function initializeArtefacts(runtime: ProviderRuntimeGateway): void {
  artefactRuntime = runtime;
  setSessionTurnHook(resolveArtefactTurnContext);
}
