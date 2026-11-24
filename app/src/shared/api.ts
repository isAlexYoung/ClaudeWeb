import {
  expireAuthSession,
  getStoredAuthToken,
  storeAuthToken,
} from '@/shared/authToken';
import type { ScheduledTaskInput, UsageDashboardRange } from '@/shared/types';

/** GraphicalPanel uses the authenticated same-origin relay for browser and ClaudeDesktop screens. */
export function graphicalSocketUrl(application: 'browser' | 'desktop', sid: string, width: number, height: number): string | null {
  const token = getStoredAuthToken();
  if (!token) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`/${application === 'desktop' ? 'claude-desktop' : 'browser'}-ws`, `${protocol}//${window.location.host}`);
  url.search = new URLSearchParams({ sid, w: String(width), h: String(height), token }).toString();
  return url.toString();
}

// Headers are a plain record rather than the full `HeadersInit` union so the
// defaults below can be merged with a caller's headers by spreading.
export type ApiRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

// Utility function for authenticated API calls
export const authenticatedFetch = (
  url: string,
  options: ApiRequestOptions = {},
): Promise<Response> => {
  const token = getStoredAuthToken();

  const defaultHeaders: Record<string, string> = {};

  // Only set JSON Content-Type when the caller is not sending FormData or raw binary streams.
  const isBinaryBody =
    options.body instanceof FormData
    || options.body instanceof Blob
    || options.body instanceof ArrayBuffer
    || ArrayBuffer.isView(options.body);
  if (!isBinaryBody) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    // Every response here can carry X-Refreshed-Token or X-Auth-Error, and a
    // served-from-cache response replays the headers it was stored with. Those
    // headers describe one moment in one session, so they must never be reused:
    // a stale X-Refreshed-Token overwrote the current token with an expired one
    // on every start, which then got discarded as expired.
    cache: 'no-store',
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  }).then((response) => {
    const refreshedToken = response.headers.get('X-Refreshed-Token');
    if (refreshedToken) {
      storeAuthToken(refreshedToken);
    }
    // Belt and braces for any path that still reaches a cached response: only a
    // real rejection ends the session. Note that a revalidated response surfaces
    // its stored status (typically 200), not the 304 from the wire, so the
    // header alone says nothing about the current request.
    if (response.status === 401 && response.headers.get('X-Auth-Error')) {
      expireAuthSession();
    }
    return response;
  });
};

// ─── Request helpers ────────────────────────────────────────────────────────
// Every endpoint below goes through these so verb, JSON encoding and query
// serialization stay consistent across the whole frontend.

type QueryValue = string | number | boolean | null | undefined;

// Serializes a query object into `?a=1&b=2` (or an empty string). Empty and
// `false` values are dropped so optional flags can be passed unconditionally.
const query = (params: Record<string, QueryValue>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === false) {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
};

/**
 * Reads a `{ success, error, details }` envelope response, throwing the server's
 * message when the request failed.
 *
 * Endpoints return a bare Response, so call sites unwrap it themselves. Most do
 * so in ways that differ deliberately (bare casts where the caller inspects the
 * payload, abort-aware reads in the git panel); this is the shared form for
 * callers that want a failed request to throw.
 */
export class ApiRequestError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(message: string, options: { code?: string; details?: unknown; status: number }) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = options.code;
    this.details = options.details;
    this.status = options.status;
  }
}

/**
 * Reads a `{ success, error, details }` envelope response, throwing an
 * ApiRequestError carrying the server's machine-readable error code when one
 * is present. Accepts both legacy string envelopes (`error: 'message'`) and
 * the structured AppError envelope (`error: { code, message, details }`).
 */
export async function readApiJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    const raw = data.error ?? data.details;
    const payload = raw && typeof raw === 'object' ? raw : {};
    const message = (typeof raw === 'string' ? raw : payload?.message) || data.details || `Request failed (${response.status})`;
    throw new ApiRequestError(message, {
      code: typeof payload?.code === 'string' ? payload.code : undefined,
      details: payload?.details ?? data.details,
      status: response.status,
    });
  }
  return data as T;
}

/**
 * Picks the server's human-readable message out of a failed response body, or
 * null when it carries none. Accepts the legacy string envelope
 * (`error: 'message'`), the structured AppError envelope
 * (`error: { code, message, details }`) and a top-level `message`.
 *
 * The non-throwing counterpart of readApiJson, used by the auth and onboarding
 * screens because they show their own localized message when the server gives
 * none, by the plugins context for failed plugin list, install, update,
 * uninstall and toggle calls, which all answer with the structured envelope,
 * and by the chat drafts store to say why the server refused a queued message.
 */
export function readApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const { error, message } = body as { error?: unknown; message?: unknown };
  const candidates = [
    error && typeof error === 'object' ? (error as { message?: unknown }).message : error,
    message,
  ];
  // The body is unchecked JSON: anything but a non-blank string is skipped, as
  // an object rendered as a React child throws and unmounts the screen.
  const readable = candidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '',
  );
  return readable ?? null;
}

const get = (url: string, options: ApiRequestOptions = {}) => authenticatedFetch(url, options);

const withBody =
  (method: string) =>
    (url: string, body?: unknown, options: ApiRequestOptions = {}) =>
      authenticatedFetch(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...options,
      });

const post = withBody('POST');
const put = withBody('PUT');
const patch = withBody('PATCH');
const del = withBody('DELETE');

// ─── URL builders ───────────────────────────────────────────────────────────
// Exported for the consumers that cannot go through `authenticatedFetch`:
// `EventSource` and `XMLHttpRequest` need a bare URL.

/**
 * Persisted messages for one session. Omitting `limit` requests the whole
 * transcript; passing one always pairs it with an explicit offset so automatic
 * refreshes can never accidentally become an unbounded transcript request.
 */
export const sessionMessagesUrl = (
  sessionId: string,
  { limit = null, offset = 0 }: { limit?: number | null; offset?: number } = {},
): string => {
  const base = `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`;
  return limit === null || limit === undefined
    ? base
    : `${base}${query({ limit, offset: offset ?? 0 })}`;
};

const fileContentPath = (projectId: string, filePath: string) =>
  `/api/file-tree/projects/${projectId}/files/content${query({ path: filePath })}`;

const pluginAssetPath = (pluginName: string, assetFile: string) =>
  `/api/plugins/${encodeURIComponent(pluginName)}/assets/${encodeURIComponent(assetFile)}`;

// ─── API endpoints ──────────────────────────────────────────────────────────
// Every `/api/...` path the frontend talks to is declared here; components
// import a named method instead of assembling URLs of their own.

export const api = {
  projectMemory: {
    list: (projectId: string) => authenticatedFetch(`/api/project-memory/${encodeURIComponent(projectId)}`),
    create: (projectId: string, body: unknown) => post(`/api/project-memory/${encodeURIComponent(projectId)}`, body),
    update: (projectId: string, id: string, body: unknown) => authenticatedFetch(`/api/project-memory/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (projectId: string, id: string, version: string) => authenticatedFetch(`/api/project-memory/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ version }) }),
  },
  sideChats: {
    list: (parentSessionId: string) => authenticatedFetch(`/api/side-chats${query({ parentSessionId })}`),
    create: (body: unknown) => post('/api/side-chats', body),
    update: (id: string, body: unknown) => authenticatedFetch(`/api/side-chats/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => authenticatedFetch(`/api/side-chats/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    send: (id: string, content: string) => post(`/api/side-chats/${encodeURIComponent(id)}/messages`, { content }),
    stop: (id: string) => post(`/api/side-chats/${encodeURIComponent(id)}/stop`, {}),
  },
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    // `choice` answers the server when other devices are signed in: join them or take over.
    login: (password: string, choice?: { mode: 'join' | 'takeover'; replace?: string }) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, ...(choice ?? {}) }),
    }),
    // Signs in with the one-time code CMCP put in the address; answers like login.
    cmcpRedeem: (code: string, choice?: { mode: 'join' | 'takeover'; replace?: string }) => fetch('/api/auth/cmcp/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...(choice ?? {}) }),
    }),
    refresh: () => post('/api/auth/refresh'),
    // Ends this device's session on the server; other devices stay signed in.
    logout: () => post('/api/auth/logout'),
    // Signed-in devices: the list, and signing another one out.
    devices: () => get('/api/auth/devices'),
    endDevice: (ref: string) => post('/api/auth/devices', { op: 'end', ref }),
    // Real use of the page (input, a working chat): keeps a browser login from going idle.
    activity: () => post('/api/auth/activity'),
    user: () => get('/api/auth/user'),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  projects: () => get('/api/projects'),
  archivedProjects: () => get('/api/projects/archived'),
  projectSessions: (
    projectId: string,
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    options: ApiRequestOptions = {},
  ) =>
    get(
      `/api/projects/${encodeURIComponent(projectId)}/sessions${query({ limit, offset })}`,
      options,
    ),
  projectTaskmaster: (projectId: string) =>
    get(`/api/projects/${encodeURIComponent(projectId)}/taskmaster`),
  renameProject: (projectId: string, displayName: string) =>
    put(`/api/projects/${projectId}/rename`, { displayName }),
  restoreProject: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/restore`),
  // `hardDelete` => server `?force=true` (remove DB row + Claude *.jsonl + sessions rows for path).
  deleteProject: (projectId: string, hardDelete = false) =>
    del(`/api/projects/${projectId}${query({ force: hardDelete })}`),
  createProject: (projectData: unknown) => post('/api/projects/create-project', projectData),
  migrateLegacyProjectStars: (projectIds: string[]) =>
    post('/api/projects/migrate-legacy-stars', { projectIds }),
  toggleProjectStar: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/toggle-star`),
  // A clone is two requests: the details (GitHub token included) go in this
  // POST body, and the returned `cloneId` is all the progress stream's URL
  // carries — URLs land in access logs, proxy logs and browser history.
  startProjectClone: (cloneRequest: {
    path: string;
    githubUrl: string;
    githubTokenId: number | null;
    newGithubToken: string | null;
  }) => post('/api/projects/clone', cloneRequest),
  // EventSource cannot send an Authorization header, so the token rides along as
  // a query parameter on the streaming endpoints below.
  cloneProjectProgressUrl: ({ cloneId }: { cloneId: string }) =>
    `/api/projects/clone-progress${query({ cloneId, token: getStoredAuthToken() })}`,
  searchConversationsUrl: (searchQuery: string, limit = 50) =>
    `/api/providers/search/sessions${query({
      q: searchQuery,
      limit,
      token: getStoredAuthToken(),
    })}`,

  // Session endpoints. Provider/project metadata are resolved by the backend
  // from the session id.
  // Session deletion mirrors project deletion:
  // - default: archive only (`isArchived = 1`)
  // - hardDelete: remove the row and, by default, its persisted transcript file
  deleteSession: (sessionId: string, hardDelete = false) =>
    del(`/api/providers/sessions/${sessionId}${query({ force: hardDelete })}`),
  getArchivedSessions: () => get('/api/providers/sessions/archived'),
  // Resolves one session (by app id or provider-native id) to its metadata and
  // owning project — used when a /session/<id> URL isn't in loaded payloads.
  sessionDetails: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}`),
  runningSessions: () => get('/api/providers/sessions/running'),
  recentConversations: ({ limit = 40, offset = 0 }: { limit?: number; offset?: number } = {}) =>
    get(`/api/providers/sessions/recent${query({ limit, offset })}`),
  providerSessionId: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/provider-id`),
  restoreSession: (sessionId: string) => post(`/api/providers/sessions/${sessionId}/restore`),
  // Creates an independent session holding this one's conversation up to
  // `upToAnchorId` (all of it when omitted). The source is left untouched.
  forkSession: (sessionId: string, body: { upToAnchorId?: string; title?: string } = {}) =>
    post(`/api/providers/sessions/${encodeURIComponent(sessionId)}/fork`, body),
  renameSession: (sessionId: string, summary: string) =>
    put(`/api/providers/sessions/${sessionId}`, { summary }),
  // What one agent of a workflow run did, read from its transcript on demand
  // when its row in the workflow card is opened.
  workflowAgentActivity: (sessionId: string, runId: string, agentId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}`),

  // Scheduled messages: send a message to a session at a future time.
  scheduledMessages: {
    list: (sessionId?: string) =>
      get(`/api/scheduled-messages${sessionId ? query({ sessionId }) : ''}`),
    create: (body: { sessionId: string; content: string; scheduledFor: string; options?: unknown }) =>
      post('/api/scheduled-messages', body),
    cancel: (id: string) => del(`/api/scheduled-messages/${encodeURIComponent(id)}`),
  },

  // Browser panel: the server's Chromium through the browser relay. Replies are the
  // gateway's own `{ code }` JSON (or the PNG for an image read).
  browser: {
    available: () => get('/api/browser/available'),
    status: (sid: string, signal?: AbortSignal) => get(`/api/browser/status${query({ sid })}`, { signal }),
    text: (body: { sid: string; op: string; text?: string }, signal?: AbortSignal) =>
      post('/api/browser/text-clipboard', body, { signal }),
    readImage: (sid: string, signal?: AbortSignal) =>
      authenticatedFetch(`/api/browser/image-clipboard${query({ sid, op: 'read' })}`, { method: 'POST', signal }),
    writeImage: (sid: string, png: Blob, signal?: AbortSignal) => authenticatedFetch(`/api/browser/image-clipboard${query({ sid, op: 'write' })}`,
      { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' }, signal }),
    end: (sid: string) => post('/api/browser/end', { sid }, { keepalive: true }),
  },
  desktop: {
    available: () => get('/api/claude-desktop/available'),
    status: (sid: string, signal?: AbortSignal) => get(`/api/claude-desktop/status${query({ sid })}`, { signal }),
    text: (body: { sid: string; op: string; text?: string }, signal?: AbortSignal) =>
      post('/api/claude-desktop/text-clipboard', body, { signal }),
    readImage: (sid: string, signal?: AbortSignal) =>
      authenticatedFetch(`/api/claude-desktop/image-clipboard${query({ sid, op: 'read' })}`, { method: 'POST', signal }),
    writeImage: (sid: string, png: Blob, signal?: AbortSignal) => authenticatedFetch(`/api/claude-desktop/image-clipboard${query({ sid, op: 'write' })}`,
      { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' }, signal }),
    end: (sid: string) => post('/api/claude-desktop/end', { sid }, { keepalive: true }),
  },

  // Claude's sudo requests waiting for the user. The password goes to sudo once and is not kept.
  sudo: {
    requests: () => get('/api/sudo/requests'),
    answer: (id: string, answer: { approve: boolean; password?: string }) =>
      post(`/api/sudo/requests/${encodeURIComponent(id)}`, answer),
  },

  // Scheduled tasks: prompts that start a new conversation on a schedule.
  scheduledTasks: {
    list: () => get('/api/scheduled-tasks'),
    create: (body: ScheduledTaskInput) => post('/api/scheduled-tasks', body),
    update: (id: string, body: ScheduledTaskInput) => put(`/api/scheduled-tasks/${encodeURIComponent(id)}`, body),
    remove: (id: string) => del(`/api/scheduled-tasks/${encodeURIComponent(id)}`),
    runNow: (id: string) => post(`/api/scheduled-tasks/${encodeURIComponent(id)}/run`),
  },

  // Artefacts: spreadsheets kept as files that Claude edits in a conversation of their own.
  artefacts: {
    list: () => get('/api/artefacts'),
    create: (body: { kind: 'sheet'; title?: string }) => post('/api/artefacts', body),
    open: (id: string) => get(`/api/artefacts/${encodeURIComponent(id)}`),
    saveContent: (id: string, body: { content: unknown; baseRevision: string }) =>
      put(`/api/artefacts/${encodeURIComponent(id)}/content`, body),
    update: (id: string, body: { title?: string; pinned?: boolean }) => patch(`/api/artefacts/${encodeURIComponent(id)}`, body),
    remove: (id: string) => del(`/api/artefacts/${encodeURIComponent(id)}`),
    state: (id: string) => get(`/api/artefacts/${encodeURIComponent(id)}/state`),
    sendMessage: (id: string, body: { text: string; sessionTitle?: string; model?: string; effort?: string; mcpEnabled?: boolean }) =>
      post(`/api/artefacts/${encodeURIComponent(id)}/messages`, body),
  },

  // Workspace file tree
  readFile: (projectId: string, filePath: string) =>
    get(`/api/file-tree/projects/${projectId}/file${query({ filePath })}`),
  // Raw bytes for a workspace file. The endpoint requires the auth header, so
  // media call sites fetch a blob through here instead of using a bare `src`.
  readFileBlob: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
    get(fileContentPath(projectId, filePath), options),
  saveFile: (projectId: string, filePath: string, content: string) =>
    put(`/api/file-tree/projects/${projectId}/file`, { filePath, content }),
  getFiles: (projectId: string, options: ApiRequestOptions = {}) =>
    get(`/api/file-tree/projects/${projectId}/files${query({ respectGitignore: true })}`, options),

  // File operations
  browseProjectFiles: (projectId: string, path?: string, options?: ApiRequestOptions) =>
    get(`/api/file-tree/projects/${encodeURIComponent(projectId)}/files/browse${query({ path })}`, options),

  createFile: (
    projectId: string,
    { path, type, name }: { path: string; type: string; name: string },
  ) => post(`/api/file-tree/projects/${projectId}/files/create`, { path, type, name }),

  renameFile: (projectId: string, { oldPath, newName }: { oldPath: string; newName: string }) =>
    put(`/api/file-tree/projects/${projectId}/files/rename`, { oldPath, newName }),

  deleteFile: (projectId: string, { path, type }: { path: string; type: string }) =>
    del(`/api/file-tree/projects/${projectId}/files`, { path, type }),

  // Uploads with a progress bar go through XMLHttpRequest, which needs the URL.
  uploadFilesUrl: (projectId: string) =>
    `/api/file-tree/projects/${encodeURIComponent(projectId)}/files/upload`,

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath: string | null = null) =>
    get(`/api/file-tree/browse-filesystem${query({ path: dirPath })}`),

  createFolder: (folderPath: string) => post('/api/file-tree/create-folder', { path: folderPath }),

  // Git endpoints. The `project` param carries the DB projectId post-migration.
  git: {
    status: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/status${query({ project: projectId })}`, options),
    diff: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/diff${query({ project: projectId, file: filePath })}`, options),
    commitDiff: (projectId: string, commit: string) =>
      get(`/api/git/commit-diff${query({ project: projectId, commit })}`),
    fileWithDiff: (projectId: string, filePath: string) =>
      get(`/api/git/file-with-diff${query({ project: projectId, file: filePath })}`),
    branches: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/branches${query({ project: projectId })}`, options),
    branchDiff: (projectId: string, base: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/branch-diff${query({ project: projectId, base })}`, options),
    // `oldPath` is the pre-rename path of a renamed file so the server can diff the rename itself.
    branchDiffFile: (
      projectId: string,
      base: string,
      filePath: string,
      oldPath?: string,
      options: ApiRequestOptions = {},
    ) => get(`/api/git/branch-diff/file${query({ project: projectId, base, file: filePath, oldPath })}`, options),
    remoteStatus: (projectId: string) =>
      get(`/api/git/remote-status${query({ project: projectId })}`),
    commits: (
      projectId: string,
      { limit }: { limit?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(`/api/git/commits${query({ project: projectId, limit })}`, options),
    checkout: (projectId: string, branch: string) =>
      post('/api/git/checkout', { project: projectId, branch }),
    createBranch: (projectId: string, branch: string) =>
      post('/api/git/create-branch', { project: projectId, branch }),
    deleteBranch: (projectId: string, branch: string, force = false) =>
      post('/api/git/delete-branch', { project: projectId, branch, force }),
    fetch: (projectId: string) => post('/api/git/fetch', { project: projectId }),
    pull: (projectId: string) => post('/api/git/pull', { project: projectId }),
    push: (projectId: string) => post('/api/git/push', { project: projectId }),
    publish: (projectId: string, branch: string) =>
      post('/api/git/publish', { project: projectId, branch }),
    discard: (projectId: string, file: string) =>
      post('/api/git/discard', { project: projectId, file }),
    deleteUntracked: (projectId: string, file: string) =>
      post('/api/git/delete-untracked', { project: projectId, file }),
    stage: (projectId: string, files: string[]) =>
      post('/api/git/stage', { project: projectId, files }),
    unstage: (projectId: string, files: string[]) =>
      post('/api/git/unstage', { project: projectId, files }),
    commit: (projectId: string, message: string, files: string[]) =>
      post('/api/git/commit', { project: projectId, message, files }),
    initialCommit: (projectId: string) => post('/api/git/initial-commit', { project: projectId }),
    init: (projectId: string) => post('/api/git/init', { project: projectId }),
    revertLocalCommit: (projectId: string) =>
      post('/api/git/revert-local-commit', { project: projectId }),
    generateCommitMessage: (projectId: string, files: string[], provider: string) =>
      post('/api/git/generate-commit-message', { project: projectId, files, provider }),
  },

  worktrees: {
    list: (projectId: string) => get(`/api/worktrees${query({ project: projectId })}`),
    create: (
      projectId: string,
      { branch, baseBranch }: { branch: string; baseBranch: string | null },
    ) => post('/api/worktrees/create', { project: projectId, branch, baseBranch }),
    open: (projectId: string, worktreePath: string) =>
      post('/api/worktrees/open', { project: projectId, worktreePath }),
    merge: (
      projectId: string,
      worktreePath: string,
      options: { squash?: boolean; message?: string; removeAfterMerge?: boolean },
    ) => post('/api/worktrees/merge', { project: projectId, worktreePath, ...options }),
    remove: (
      projectId: string,
      worktreePath: string,
      options: { force?: boolean; deleteBranch?: boolean },
    ) => post('/api/worktrees/remove', { project: projectId, worktreePath, ...options }),
  },

  // Provider (coding agent) endpoints — models, capabilities, sessions, MCP, skills.
  providers: {
    capabilities: () => get('/api/providers/capabilities'),
    authStatus: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/auth/status`),
    cliStatus: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/cli`),
    updateCli: (provider: string) =>
      post(`/api/providers/${encodeURIComponent(provider)}/cli/update`),
    claudeSettingsPermissions: () => get('/api/providers/claude/settings-permissions'),
    yourClaude: () => get('/api/providers/claude/your-claude'),
    updateYourClaude: (input: unknown) => put('/api/providers/claude/your-claude', input),

    models: (provider: string) => get(`/api/providers/${provider}/models`),
    createModel: (provider: string, input: unknown) =>
      post(`/api/providers/${provider}/models`, input),
    updateModel: (provider: string, recordId: string | number, input: unknown) =>
      patch(`/api/providers/${provider}/models/${recordId}`, input),
    deleteModel: (provider: string, recordId: string | number) =>
      del(`/api/providers/${provider}/models/${recordId}`),
    setCustomModelsOnly: (provider: string, enabled: boolean) =>
      put(`/api/providers/${provider}/models/custom-only`, { enabled }),

    createSession: (payload: {
      provider: string;
      projectPath: string;
      initialMessage?: unknown;
    }) => post('/api/providers/sessions', payload),
    sessionMessages: (
      sessionId: string,
      pagination: { limit?: number | null; offset?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(sessionMessagesUrl(sessionId, pagination), options),
    sessionTokenUsage: (sessionId: string) =>
      get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/token-usage`),
    sessionActiveModel: (provider: string, sessionId: string) =>
      get(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`),
    setSessionActiveModel: (provider: string, sessionId: string, model: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`, {
        model,
      }),
    setSessionActiveEffort: (provider: string, sessionId: string, effort: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-effort`, {
        effort,
      }),

    mcpConnections: (provider: string, params: { workspacePath?: string; sessionId?: string }, options?: ApiRequestOptions) =>
      get(`/api/providers/${encodeURIComponent(provider)}/mcp/connections${query(params)}`, options),
    mcpServers: (
      provider: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) => get(`/api/providers/${provider}/mcp/servers${query({ scope, workspacePath })}`),
    saveMcpServer: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/mcp/servers`, payload),
    setMcpEnabled: (provider: string, serverName: string, payload: { enabled: boolean; scope: string; workspacePath?: string }) =>
      put(`/api/providers/${encodeURIComponent(provider)}/mcp/servers/${encodeURIComponent(serverName)}/enable`, payload),
    deleteMcpServer: (
      provider: string,
      serverName: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) =>
      del(
        `/api/providers/${provider}/mcp/servers/${encodeURIComponent(serverName)}${query({ scope, workspacePath })}`,
      ),
    saveGlobalMcpServer: (payload: unknown) => post('/api/providers/mcp/servers/global', payload),

    skills: (provider: string, { workspacePath, includeDisabled }: { workspacePath?: string; includeDisabled?: boolean } = {}) =>
      get(`/api/providers/${encodeURIComponent(provider)}/skills${query({ workspacePath, includeDisabled: includeDisabled ? '1' : undefined })}`),
    setSkillEnabled: (provider: string, payload: { sourcePath: string; enabled: boolean; workspacePath?: string }) =>
      put(`/api/providers/${encodeURIComponent(provider)}/skills/state`, payload),
    removeSkillEntry: (provider: string, payload: { sourcePath: string; workspacePath?: string }) =>
      post(`/api/providers/${encodeURIComponent(provider)}/skills/remove-entry`, payload),
    saveSkills: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/skills`, payload),
    importSkill: (provider: string, url: string) =>
      post(`/api/providers/${encodeURIComponent(provider)}/skills/import`, { url }),
  },

  // Slash commands
  commands: {
    // `projectPath` stays optional: a workspace without a resolved path omits
    // the field entirely, which is what the server expects.
    list: (projectPath: string | undefined) => post('/api/commands/list', { projectPath }),
    execute: (payload: unknown) => post('/api/commands/execute', payload),
  },

  // Chat attachments, stored globally under ~/.claudeweb/assets
  assets: {
    uploadFiles: (formData: FormData) =>
      authenticatedFetch('/api/assets/files', {
        method: 'POST',
        headers: {}, // Let browser set Content-Type for FormData
        body: formData,
      }),
    file: (storedName: string) => get(`/api/assets/files/${encodeURIComponent(storedName)}`),
    image: (filename: string, options: ApiRequestOptions = {}) =>
      get(`/api/assets/images/${encodeURIComponent(filename)}`, options),
    // Attachments of up to 256 MB go up in pieces so no request exceeds the 100 MB Cloudflare cap.
    createUpload: (upload: { name: string; size: number; mimeType?: string; projectPath?: string; sessionId?: string }) =>
      post('/api/assets/uploads', upload),
    uploadChunk: (uploadId: string, index: number, chunk: Blob, signal?: AbortSignal) =>
      authenticatedFetch(`/api/assets/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`, {
        method: 'PUT',
        body: chunk,
        headers: { 'Content-Type': 'application/octet-stream' },
        signal,
      }),
    completeUpload: (uploadId: string, signal?: AbortSignal) => post(`/api/assets/uploads/${encodeURIComponent(uploadId)}/complete`, undefined, { signal }),
    cancelUpload: (uploadId: string) => del(`/api/assets/uploads/${encodeURIComponent(uploadId)}`),
    // Project menu > File management.
    projectFiles: (projectPath: string) => get(`/api/assets/project-files${query({ projectPath })}`),
    downloadProjectFile: (storedName: string) =>
      get(`/api/assets/project-files/${encodeURIComponent(storedName)}/download`),
    deleteProjectFile: (storedName: string) => del(`/api/assets/project-files/${encodeURIComponent(storedName)}`),
  },

  // TaskMaster endpoints — all addressed by DB projectId post-migration.
  taskmaster: {
    initialize: (projectId: string) => post(`/api/taskmaster/init/${encodeURIComponent(projectId)}`),
    // Update a task
    updateTask: (projectId: string, taskId: string | number, updates: unknown) =>
      put(`/api/taskmaster/update-task/${projectId}/${taskId}`, updates),

    tasks: (projectId: string) => get(`/api/taskmaster/tasks/${encodeURIComponent(projectId)}`),
    mcpStatus: () => get('/api/taskmaster/mcp-status'),
    installationStatus: () => get('/api/taskmaster/installation-status'),

    prdFiles: (projectId: string) => get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`),
    prdFile: (projectId: string, fileName: string) =>
      get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`),
    savePrd: (projectId: string, { fileName, content }: { fileName: string; content: string }) =>
      post(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`, { fileName, content }),
  },

  // User endpoints
  user: {
    onboardingStatus: () => get('/api/user/onboarding-status'),
    completeOnboarding: () => post('/api/user/complete-onboarding'),

    // Preferences and chat drafts live server-side so they follow the user
    // from one device to another. `savePreferences` is a merge-patch: only the
    // keys it is given are written.
    preferences: () => get('/api/user/preferences'),
    savePreferences: (updates: Record<string, unknown>) =>
      patch('/api/user/preferences', updates),
    drafts: () => get('/api/user/drafts'),
    // Without `queuedMessage` only the text is written; the stored queued
    // message is left as it is.
    saveDraft: (scope: string, draft: { text: string; queuedMessage?: unknown }) =>
      put('/api/user/drafts', { scope, ...draft }),
    // Appends to the scope's queued message on the server and returns the
    // message that is now queued.
    appendQueuedMessage: (scope: string, queuedMessage: unknown) =>
      post('/api/user/drafts/queued-message', { scope, queuedMessage }),
    clearQueuedMessage: (scope: string) => del('/api/user/drafts/queued-message', { scope }),
    sendQueuedMessageNow: (sessionId: string) => post('/api/scheduled-messages/queued/send', { sessionId }),
    changeQueuedMessage: (sessionId: string, expectedContent: string, content: string | null) => post('/api/scheduled-messages/queued/change', { sessionId, expectedContent, content }),
  },

  // Server-side settings: API keys, stored credentials, notifications, web push
  settings: {
    apiKeys: () => get('/api/settings/api-keys'),
    createApiKey: (keyName: string) => post('/api/settings/api-keys', { keyName }),
    deleteApiKey: (keyId: string) => del(`/api/settings/api-keys/${keyId}`),
    toggleApiKey: (keyId: string, isActive: boolean) =>
      patch(`/api/settings/api-keys/${keyId}/toggle`, { isActive }),

    credentials: (type: string) => get(`/api/settings/credentials${query({ type })}`),
    createCredential: (payload: {
      credentialName: string;
      credentialType: string;
      credentialValue: string;
      description?: string;
    }) => post('/api/settings/credentials', payload),
    deleteCredential: (credentialId: string) => del(`/api/settings/credentials/${credentialId}`),
    toggleCredential: (credentialId: string, isActive: boolean) =>
      patch(`/api/settings/credentials/${credentialId}/toggle`, { isActive }),

    notificationPreferences: () => get('/api/settings/notification-preferences'),
    saveNotificationPreferences: (preferences: unknown) =>
      put('/api/settings/notification-preferences', preferences),

    push: {
      vapidPublicKey: () => get('/api/settings/push/vapid-public-key'),
      subscribe: (subscription: { endpoint?: string; keys?: unknown }) =>
        post('/api/settings/push/subscribe', subscription),
      unsubscribe: (endpoint: string) => post('/api/settings/push/unsubscribe', { endpoint }),
    },

  },

  // Settings > Backup & restore. Imports go up in pieces so no request exceeds
  // the 100 MB Cloudflare cap; the export is a one-time browser download.
  backup: {
    prepareExport: (password?: string, projectFiles?: string[]) => post('/api/backup/exports', {
      ...(password ? { password } : {}),
      ...(projectFiles && projectFiles.length > 0 ? { projectFiles } : {}),
    }),
    // Project folders that can be added to a backup (inside the home folder).
    projectFolders: () => get('/api/backup/project-folders'),
    // A link the browser follows itself, so it carries the sub-path that fetch adds automatically.
    downloadUrl: (downloadId: string) =>
      `/${import.meta.env.BASE_URL.replace(/^\/+|\/+$/g, '')}/api/backup-download/${encodeURIComponent(downloadId)}`.replace(/^\/\//, '/'),
    createImport: (size: number) => post('/api/backup/imports', { size }),
    uploadChunk: (importId: string, index: number, chunk: Blob) =>
      authenticatedFetch(`/api/backup/imports/${encodeURIComponent(importId)}/chunks/${index}`, {
        method: 'PUT',
        body: chunk,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    status: (importId: string) => get(`/api/backup/imports/${encodeURIComponent(importId)}`),
    preview: (importId: string, password?: string) =>
      post(`/api/backup/imports/${encodeURIComponent(importId)}/preview`, password ? { password } : {}),
    apply: (importId: string, projects: string[]) =>
      post(`/api/backup/imports/${encodeURIComponent(importId)}/apply`, { projects }),
    cancel: (importId: string) => del(`/api/backup/imports/${encodeURIComponent(importId)}`),
  },

  // Settings > About: ClaudeWeb updates itself through the root updater.
  claudewebUpdate: {
    status: () => get('/api/claudeweb-update/status'),
    check: () => post('/api/claudeweb-update/check', {}),
    update: (version: string) => post('/api/claudeweb-update/update', { version }),
    // How many conversations (scheduled tasks included) the restart would interrupt.
    activity: () => get('/api/claudeweb-update/activity'),
  },

  // Code home reads local history through the existing authenticated plugin transport.
  usageDashboard: (range: UsageDashboardRange, timeZone: string, excludedProject: string) =>
    api.plugins.rpc('claude-usage', 'GET', `/dashboard?${new URLSearchParams({ range, timeZone, excludeProject: excludedProject })}`),

  publicAppearance: {
    get: () => fetch('/api/public/appearance', { cache: 'no-store' }),
    mediaUrl: (hash: string) => `/api/public/appearance/media/${encodeURIComponent(hash)}`,
  },

  plugins: {
    list: () => get('/api/plugins'),
    install: (url: string) => post('/api/plugins/install', { url }),
    uninstall: (name: string, options?: { removeData?: boolean }) =>
      del(`/api/plugins/${encodeURIComponent(name)}${options?.removeData ? '?removeData=1' : ''}`),
    update: (name: string) => post(`/api/plugins/${encodeURIComponent(name)}/update`),
    restart: (name: string) => post(`/api/plugins/${encodeURIComponent(name)}/restart`),
    toggle: (name: string, enabled: boolean, options?: { takeoverBackground?: boolean }) =>
      put(`/api/plugins/${encodeURIComponent(name)}/enable`, {
        enabled,
        ...(options?.takeoverBackground ? { takeoverBackground: true } : {}),
      }),
    setActiveBackground: (name: string | null) =>
      put('/api/plugins/background/active', { name }),
    createMediaTicket: (pluginName: string, path: string, ttlMs?: number) =>
      post(`/api/plugins/${encodeURIComponent(pluginName)}/media-ticket`, {
        path,
        ...(ttlMs !== undefined ? { ttlMs } : {}),
      }),
    uploadPublicAppearanceMedia: (pluginName: string, data: Blob | ArrayBuffer | Uint8Array, contentType?: string) =>
      authenticatedFetch(`/api/plugins/${encodeURIComponent(pluginName)}/public-appearance/media`, {
        method: 'POST',
        body: data instanceof Uint8Array ? new Blob([new Uint8Array(data)], { type: contentType || 'application/octet-stream' }) : data,
        headers: {
          'Content-Type': contentType || (data instanceof Blob && data.type ? data.type : 'application/octet-stream'),
        },
      }),
    publishPublicAppearance: (pluginName: string, payload: unknown) =>
      put(`/api/plugins/${encodeURIComponent(pluginName)}/public-appearance`, payload),
    clearPublicAppearance: (pluginName: string) =>
      del(`/api/plugins/${encodeURIComponent(pluginName)}/public-appearance`),
    // Plugin bundles/icons are fetched with auth headers and handed to the
    // browser as blobs, so a bare asset URL is never requested unauthenticated.
    asset: (pluginName: string, assetFile: string) => get(pluginAssetPath(pluginName, assetFile)),
    // Exposed so the icon cache can key on the resolved asset path.
    assetUrl: pluginAssetPath,
    rpc: (pluginName: string, method: string, path: string, body?: unknown) =>
      authenticatedFetch(
        `/api/plugins/${encodeURIComponent(pluginName)}/rpc/${String(path).replace(/^\//, '')}`,
        {
          method: method || 'GET',
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
      ),
    rpcRaw: (
      pluginName: string,
      method: string,
      path: string,
      init?: { body?: BodyInit | null; headers?: Record<string, string>; signal?: AbortSignal },
    ) =>
      authenticatedFetch(
        `/api/plugins/${encodeURIComponent(pluginName)}/rpc/${String(path).replace(/^\//, '')}`,
        {
          method: method || 'GET',
          ...(init?.body !== undefined ? { body: init.body } : {}),
          ...(init?.headers ? { headers: init.headers } : {}),
          ...(init?.signal ? { signal: init.signal } : {}),
        },
      ),
  },

};
