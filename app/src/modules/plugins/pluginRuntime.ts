import { api } from '@/shared/api';
import { getStoredAuthToken } from '@/shared/authToken';
import type {
  ClaudeWebPluginModule,
  Plugin,
  PluginAgentRunSnapshot,
  PluginAgentRunState,
  PluginHostApi,
  PluginHostContext,
  PluginHostEvent,
  PluginHostInfo,
  PluginSlot,
  PluginWallpaperSurfaceVars,
  PublicAppearanceState,
  ServerEvent,
} from '@/shared/types';

export const DEFAULT_HOST_INFO: PluginHostInfo = {
  version: '2.2.6',
  apiVersion: 2,
  capabilities: [
    'slots:tab',
    'slots:background',
    'slots:overlay',
    'slots:settings',
    'media-ticket',
    'rpc-raw-stream',
    'agent-events-v1',
    'public-appearance-v1',
    'style-manager',
    'surface-wallpaper-vars',
  ],
  activeBackgroundPlugin: null,
};

const SAFE_MODE_STORAGE_KEY = 'claudeweb:plugin-safe-mode';
const CRASH_GUARD_STORAGE_KEY = 'claudeweb:plugin-boot-guard';
const PLUGIN_STORAGE_PREFIX = 'cw-plugin:';

/** Returns the normalized slots list for a plugin (falls back to `[plugin.slot]` for v1). */
export function getPluginSlots(plugin: Pick<Plugin, 'slot' | 'slots'>): PluginSlot[] {
  if (Array.isArray(plugin.slots) && plugin.slots.length > 0) return plugin.slots;
  return [plugin.slot || 'tab'];
}

/** Detects whether Safe Mode was requested via `?safe-plugins=1`, `#safe-plugins`, or sessionStorage. */
export function readPluginSafeMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('safe-plugins') === '1' || window.location.hash === '#safe-plugins') {
      sessionStorage.setItem(SAFE_MODE_STORAGE_KEY, '1');
      return true;
    }
    return sessionStorage.getItem(SAFE_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearPluginSafeMode(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    const url = new URL(window.location.href);
    if (url.searchParams.has('safe-plugins') || url.hash === '#safe-plugins') {
      url.searchParams.delete('safe-plugins');
      if (url.hash === '#safe-plugins') url.hash = '';
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  } catch { /* ignore */ }
}

/**
 * Boot Crash Guard: records which plugins were initializing when an uncaught crash happened,
 * so a reloading browser automatically skips a crashing plugin instead of locking out Settings.
 */
export function readBootBlockedPlugins(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = JSON.parse(sessionStorage.getItem(CRASH_GUARD_STORAGE_KEY) || '{}') as {
      inFlight?: string[];
      blocked?: string[];
    };
    const nextBlocked = new Set<string>(Array.isArray(raw.blocked) ? raw.blocked : []);
    if (Array.isArray(raw.inFlight) && raw.inFlight.length > 0) {
      for (const name of raw.inFlight) nextBlocked.add(name);
      sessionStorage.setItem(CRASH_GUARD_STORAGE_KEY, JSON.stringify({
        inFlight: [],
        blocked: [...nextBlocked],
      }));
    }
    return nextBlocked;
  } catch {
    return new Set();
  }
}

export function markPluginBootInFlight(pluginName: string, active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = JSON.parse(sessionStorage.getItem(CRASH_GUARD_STORAGE_KEY) || '{}') as {
      inFlight?: string[];
      blocked?: string[];
    };
    const inFlight = new Set<string>(Array.isArray(raw.inFlight) ? raw.inFlight : []);
    if (active) inFlight.add(pluginName);
    else inFlight.delete(pluginName);
    sessionStorage.setItem(CRASH_GUARD_STORAGE_KEY, JSON.stringify({
      inFlight: [...inFlight],
      blocked: Array.isArray(raw.blocked) ? raw.blocked : [],
    }));
  } catch { /* ignore */ }
}

export function clearBootBlockedPlugin(pluginName: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = JSON.parse(sessionStorage.getItem(CRASH_GUARD_STORAGE_KEY) || '{}') as {
      inFlight?: string[];
      blocked?: string[];
    };
    const blocked = (Array.isArray(raw.blocked) ? raw.blocked : []).filter((n) => n !== pluginName);
    sessionStorage.setItem(CRASH_GUARD_STORAGE_KEY, JSON.stringify({
      inFlight: Array.isArray(raw.inFlight) ? raw.inFlight : [],
      blocked,
    }));
  } catch { /* ignore */ }
}

/** Applies or clears the host wallpaper surface contract on `document.documentElement`. */
export function applyWallpaperSurfaceVars(vars: PluginWallpaperSurfaceVars | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!vars || vars.scope === 'none') {
    delete root.dataset.cwWallpaper;
    delete root.dataset.cwWallpaperTone;
    root.style.removeProperty('--cw-surface-opacity');
    root.style.removeProperty('--cw-glass-blur');
    return;
  }
  const opacity = Math.min(0.95, Math.max(0.06, Number.isFinite(vars.surfaceOpacity) ? vars.surfaceOpacity : 0.36));
  const blur = Math.min(40, Math.max(0, Number.isFinite(vars.glassBlurPx) ? vars.glassBlurPx : 20));
  const resolvedTone: 'dark' | 'light' =
    vars.tone === 'dark' || vars.tone === 'light'
      ? vars.tone
      : root.dataset.theme === 'dark' || root.classList.contains('dark')
        ? 'dark'
        : 'light';
  root.dataset.cwWallpaper = vars.scope;
  root.dataset.cwWallpaperTone = resolvedTone;
  root.style.setProperty('--cw-surface-opacity', String(opacity));
  root.style.setProperty('--cw-glass-blur', `${blur}px`);
}

/** Managed per-plugin `<style>` injection so disabling or uninstalling leaves zero residual rules. */
export function createPluginStyleManager(pluginName: string) {
  const elements = new Map<string, HTMLStyleElement>();

  function set(id: string, cssText: string): void {
    if (typeof document === 'undefined') return;
    const safeId = String(id || 'default').slice(0, 64);
    let el = elements.get(safeId);
    if (!el) {
      el = document.createElement('style');
      el.dataset.cwPlugin = pluginName;
      el.dataset.cwStyle = safeId;
      document.head.appendChild(el);
      elements.set(safeId, el);
    }
    el.textContent = String(cssText ?? '');
  }

  function remove(id: string): void {
    const safeId = String(id || 'default').slice(0, 64);
    const el = elements.get(safeId);
    if (el) {
      el.remove();
      elements.delete(safeId);
    }
  }

  function clearAll(): void {
    for (const el of elements.values()) {
      el.remove();
    }
    elements.clear();
  }

  return { set, remove, clearAll };
}

/** Removes any lingering style tags belonging to `pluginName` across DOM instances. */
export function purgePluginStyles(pluginName: string): void {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll<HTMLStyleElement>('style[data-cw-plugin]');
  nodes.forEach((node) => {
    if (node.dataset.cwPlugin === pluginName) {
      node.remove();
    }
  });
}

/** Builds a complete PluginHostContext snapshot including reducedMotion and mobile viewport flags. */
export function buildPluginHostContext(params: {
  isDarkMode: boolean;
  themeMode: 'warm' | 'light' | 'dark' | 'system';
  locale: string;
  route?: PluginHostContext['route'];
  project?: PluginHostContext['project'];
  session?: PluginHostContext['session'];
}): PluginHostContext {
  const resolvedThemeMode: 'warm' | 'light' | 'dark' =
    params.themeMode === 'warm' ? 'warm' : params.isDarkMode ? 'dark' : 'light';
  const reducedMotion =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const isMobile =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 767px)').matches);
  return {
    theme: params.isDarkMode ? 'dark' : 'light',
    themeMode: resolvedThemeMode,
    locale: params.locale || 'en',
    route: params.route ?? 'workspace',
    project: params.project ?? null,
    session: params.session ?? null,
    reducedMotion,
    isMobile,
  };
}

const moduleCache = new Map<string, Promise<ClaudeWebPluginModule>>();

/** Dynamically imports a plugin's ES module entry through authenticated fetch + temporary Blob URL. */
export async function importPluginModule(pluginName: string, entryFile: string): Promise<ClaudeWebPluginModule> {
  const res = await api.plugins.asset(pluginName, entryFile);
  if (!res.ok) {
    throw new Error(`Failed to fetch plugin (HTTP ${res.status})`);
  }
  const jsText = await res.text();
  const blob = new Blob([jsText], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    // @vite-ignore
    const mod = await import(/* @vite-ignore */ blobUrl);
    return mod as ClaudeWebPluginModule;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Loads a plugin module once per `(pluginName, entryFile, revision)` so `mountLayer`, `mountSettings`,
 * and `mount` share one live ES module instance for the same version (enabling instant local draft
 * preview between settings drawer and background layer without duplicate fetches).
 */
export function loadPluginModule(
  pluginName: string,
  entryFile: string,
  revision = 0,
): Promise<ClaudeWebPluginModule> {
  const key = `${pluginName}::${entryFile}::${revision}`;
  const existing = moduleCache.get(key);
  if (existing) return existing;
  const promise = importPluginModule(pluginName, entryFile).catch((err) => {
    moduleCache.delete(key);
    throw err;
  });
  moduleCache.set(key, promise);
  return promise;
}

/** Evicts cached ES module promises for a plugin (or all plugins when omitted). */
export function evictPluginModuleCache(pluginName?: string): void {
  if (!pluginName) {
    moduleCache.clear();
    return;
  }
  const prefix = `${pluginName}::`;
  for (const key of moduleCache.keys()) {
    if (key.startsWith(prefix)) {
      moduleCache.delete(key);
    }
  }
}

/** Semantic event bus translating raw WebSocket frames into stable, reconnect-reconcilable plugin events. */
export type PluginEventBus = {
  ingestServerEvent: (frame: ServerEvent, focusedSessionId: string | null) => void;
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected', reconnected?: boolean) => void;
  on: PluginHostApi['events']['on'];
  getSnapshot: PluginHostApi['events']['getSnapshot'];
  clear: () => void;
};

export function createPluginEventBus(): PluginEventBus {
  let seq = 0;
  let connection: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  const activeRuns = new Map<string, PluginAgentRunSnapshot>();
  const listeners = new Map<PluginHostEvent['type'], Set<(event: any) => void>>();

  function emit(event: PluginHostEvent): void {
    const bucket = listeners.get(event.type);
    if (!bucket) return;
    for (const cb of bucket) {
      try { cb(event); } catch { /* isolate plugin listener errors */ }
    }
  }

  function ensureRun(sessionId: string, frame: ServerEvent, focusedSessionId: string | null): PluginAgentRunSnapshot {
    const existing = activeRuns.get(sessionId);
    const runId = typeof frame.runId === 'string' && frame.runId
      ? frame.runId
      : existing?.runId ?? `${sessionId}:${Date.now()}`;
    const turnId = typeof frame.turnId === 'string' && frame.turnId
      ? frame.turnId
      : existing?.turnId ?? runId;
    const next: PluginAgentRunSnapshot = {
      sessionId,
      turnId,
      runId,
      state: existing?.state ?? 'idle',
      toolName: existing?.toolName,
      isFocusedSession: Boolean(focusedSessionId && focusedSessionId === sessionId),
      updatedAt: Date.now(),
    };
    activeRuns.set(sessionId, next);
    return next;
  }

  function transitionState(
    sessionId: string,
    frame: ServerEvent,
    focusedSessionId: string | null,
    nextState: PluginAgentRunState,
    toolName?: string,
  ): PluginAgentRunSnapshot {
    const run = ensureRun(sessionId, frame, focusedSessionId);
    const changed = run.state !== nextState || run.toolName !== toolName;
    run.state = nextState;
    run.toolName = toolName;
    run.updatedAt = Date.now();
    if (changed) {
      seq += 1;
      emit({
        type: 'agent:state',
        seq,
        timestamp: run.updatedAt,
        sessionId: run.sessionId,
        turnId: run.turnId,
        runId: run.runId,
        state: nextState,
        ...(toolName ? { toolName } : {}),
        isFocusedSession: run.isFocusedSession,
      });
    }
    return run;
  }

  return {
    ingestServerEvent(frame: ServerEvent, focusedSessionId: string | null) {
      const kind = typeof frame.kind === 'string' ? frame.kind : typeof frame.type === 'string' ? frame.type : '';
      const sid = typeof frame.sessionId === 'string' ? frame.sessionId : '';
      const now = Date.now();

      if (kind === 'websocket_reconnected') {
        connection = 'connected';
        seq += 1;
        emit({ type: 'connection:status', seq, timestamp: now, status: 'connected', reconnected: true });
        return;
      }

      if (kind === 'sudo_requests_changed') {
        seq += 1;
        emit({
          type: 'sudo:requested',
          seq,
          timestamp: now,
          active: true,
          ...(typeof frame.requestId === 'string' ? { requestId: frame.requestId } : {}),
        });
        return;
      }

      if (!sid) return;

      if (kind === 'chat_subscribed') {
        if (frame.isProcessing === false) {
          const existing = activeRuns.get(sid);
          if (existing) {
            transitionState(sid, frame, focusedSessionId, 'idle');
            activeRuns.delete(sid);
          }
          return;
        }
        if (frame.isProcessing === true) {
          const pending = Array.isArray(frame.pendingPermissions) ? frame.pendingPermissions : [];
          if (pending.length > 0) {
            const first = pending[0] as { toolName?: unknown } | undefined;
            const rawTool = typeof first?.toolName === 'string' ? first.toolName.slice(0, 64) : undefined;
            transitionState(sid, frame, focusedSessionId, 'waiting_approval', rawTool);
          } else {
            transitionState(sid, frame, focusedSessionId, 'thinking');
          }
        }
        return;
      }

      if (kind === 'protocol_error') {
        if (frame.code !== 'NO_SUCH_TASK' && frame.code !== 'TASK_ID_REQUIRED') {
          const run = transitionState(sid, frame, focusedSessionId, 'error');
          seq += 1;
          emit({
            type: 'chat:turn-finished',
            seq,
            timestamp: now,
            sessionId: run.sessionId,
            turnId: run.turnId,
            runId: run.runId,
            outcome: 'error',
          });
          activeRuns.delete(sid);
        }
        return;
      }

      if (kind === 'user_message' || kind === 'chat_user_sent') {
        const run = ensureRun(sid, frame, focusedSessionId);
        seq += 1;
        emit({ type: 'chat:user-sent', seq, timestamp: now, sessionId: sid, turnId: run.turnId });
        transitionState(sid, frame, focusedSessionId, 'thinking');
        return;
      }

      if (kind === 'status') {
        const text = typeof frame.text === 'string' ? frame.text : '';
        if (
          text === 'prompt_suggestion_turn'
          || text === 'prompt_suggestion'
          || text === 'context_usage'
          || text === 'usage_limit'
          || text === 'token_budget'
        ) {
          return;
        }
        transitionState(sid, frame, focusedSessionId, 'thinking');
        return;
      }

      if (kind === 'loading_progress' || kind === 'thinking') {
        transitionState(sid, frame, focusedSessionId, 'thinking');
        return;
      }

      if (kind === 'stream_delta') {
        transitionState(sid, frame, focusedSessionId, 'streaming');
        return;
      }

      if (kind === 'tool_use') {
        const rawTool = typeof frame.toolName === 'string'
          ? frame.toolName.slice(0, 64)
          : typeof frame.name === 'string'
            ? frame.name.slice(0, 64)
            : undefined;
        transitionState(sid, frame, focusedSessionId, 'tool_use', rawTool);
        return;
      }

      if (kind === 'permission_request') {
        const rawTool = typeof frame.toolName === 'string' ? frame.toolName.slice(0, 64) : undefined;
        transitionState(sid, frame, focusedSessionId, 'waiting_approval', rawTool);
        return;
      }

      if (kind === 'permission_resolved' || kind === 'permission_cancelled') {
        transitionState(sid, frame, focusedSessionId, 'thinking');
        return;
      }

      if (kind === 'complete') {
        const outcome: 'completed' | 'cancelled' | 'error' = frame.aborted === true
          ? 'cancelled'
          : frame.success === false
            ? 'error'
            : 'completed';
        const run = transitionState(sid, frame, focusedSessionId, outcome);
        seq += 1;
        emit({
          type: 'chat:turn-finished',
          seq,
          timestamp: now,
          sessionId: run.sessionId,
          turnId: run.turnId,
          runId: run.runId,
          outcome,
        });
        activeRuns.delete(sid);
      }
    },

    setConnectionStatus(status, reconnected = false) {
      if (connection === status && !reconnected) return;
      connection = status;
      seq += 1;
      emit({
        type: 'connection:status',
        seq,
        timestamp: Date.now(),
        status,
        ...(reconnected ? { reconnected: true } : {}),
      });
    },

    on(type, cb) {
      let bucket = listeners.get(type);
      if (!bucket) {
        bucket = new Set();
        listeners.set(type, bucket);
      }
      bucket.add(cb);
      return () => {
        bucket?.delete(cb);
      };
    },

    getSnapshot() {
      return {
        connection,
        activeRuns: [...activeRuns.values()].map((r) => ({ ...r })),
      };
    },

    clear() {
      activeRuns.clear();
      listeners.clear();
    },
  };
}

export type CreateHostApiOptions = {
  plugin: Plugin;
  hostInfo: PluginHostInfo;
  signal: AbortSignal;
  getContext: () => PluginHostContext;
  subscribeContext: (cb: (ctx: PluginHostContext) => void) => () => void;
  eventBus: PluginEventBus;
  styleManager: ReturnType<typeof createPluginStyleManager>;
  allowSurface: boolean;
  onClosePanel?: () => void;
  onNotify?: (message: string, tone?: 'info' | 'success' | 'error') => void;
  onPanelDirtyChange?: (dirty: boolean) => void;
};

/** Constructs the standard v2 PluginHostApi (fully backward-compatible with v1 plugins). */
export function createPluginHostApi(options: CreateHostApiOptions): PluginHostApi {
  const { plugin, hostInfo, signal, getContext, subscribeContext, eventBus, styleManager, allowSurface } = options;
  const capabilities = new Set<string>(hostInfo.capabilities);
  const pluginName = plugin.name;
  const storagePrefix = `${PLUGIN_STORAGE_PREFIX}${pluginName}:`;

  const hostApi: PluginHostApi = {
    pluginName,
    hostVersion: hostInfo.version,
    apiVersion: hostInfo.apiVersion,
    capabilities,
    signal,

    get context(): PluginHostContext {
      return getContext();
    },

    onContextChange(cb) {
      return subscribeContext(cb);
    },

    events: {
      on: eventBus.on,
      getSnapshot: eventBus.getSnapshot,
    },

    async rpc<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
      const res = await api.plugins.rpc(pluginName, method, path, body);
      if (!res.ok) {
        let message = `RPC error ${res.status}`;
        try {
          const parsed = await res.json();
          if (typeof parsed?.error === 'string') message = parsed.error;
          else if (typeof parsed?.error?.message === 'string') message = parsed.error.message;
        } catch { /* keep HTTP status message */ }
        throw Object.assign(new Error(message), { status: res.status });
      }
      return res.json() as Promise<T>;
    },

    rpcRaw(method, path, init) {
      return api.plugins.rpcRaw(pluginName, method, path, {
        ...init,
        signal: init?.signal ?? signal,
      });
    },

    media: {
      async createUrl(path: string, ttlMs?: number) {
        const res = await api.plugins.createMediaTicket(pluginName, path, ttlMs);
        if (!res.ok) throw new Error(`Failed to create media ticket (HTTP ${res.status})`);
        const data = (await res.json()) as { url: string; expiresAt: number };
        return { url: data.url, expiresAt: data.expiresAt };
      },
    },

    assets: {
      fetch(relativePath: string) {
        return api.plugins.asset(pluginName, relativePath);
      },
    },

    ws: {
      connect() {
        const token = getStoredAuthToken();
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = new URL(`/plugin-ws/${encodeURIComponent(pluginName)}`, `${protocol}//${window.location.host}`);
        if (token) url.searchParams.set('token', token);
        return new WebSocket(url.toString());
      },
    },

    style: styleManager,

    ...(allowSurface
      ? {
          surface: {
            setWallpaperVars: (vars) => {
              if (!signal.aborted) applyWallpaperSurfaceVars(vars);
            },
            clear: () => {
              applyWallpaperSurfaceVars(null);
            },
          },
        }
      : {}),

    storage: {
      get<T = unknown>(key: string): T | null {
        try {
          const raw = localStorage.getItem(storagePrefix + key);
          return raw === null ? null : (JSON.parse(raw) as T);
        } catch {
          return null;
        }
      },
      set(key: string, value: unknown): void {
        try {
          localStorage.setItem(storagePrefix + key, JSON.stringify(value));
        } catch { /* storage quota or privacy mode */ }
      },
      remove(key: string): void {
        try {
          localStorage.removeItem(storagePrefix + key);
        } catch { /* ignore */ }
      },
    },

    ...(plugin.publicAppearance
      ? {
          publicAppearance: {
            async uploadMedia(data, contentType) {
              const res = await api.plugins.uploadPublicAppearanceMedia(pluginName, data, contentType);
              if (!res.ok) throw new Error(`Failed to upload login media (HTTP ${res.status})`);
              return res.json() as Promise<{ hash: string; mimeType: string; bytes: number }>;
            },
            async publish(payload) {
              const res = await api.plugins.publishPublicAppearance(pluginName, payload);
              if (!res.ok) throw new Error(`Failed to publish login appearance (HTTP ${res.status})`);
              return res.json() as Promise<{ appearance: PublicAppearanceState }>;
            },
            async clear() {
              const res = await api.plugins.clearPublicAppearance(pluginName);
              if (!res.ok) throw new Error(`Failed to clear login appearance (HTTP ${res.status})`);
            },
          },
        }
      : {}),

    ui: {
      closePanel: () => { options.onClosePanel?.(); },
      notify: (message, tone) => { options.onNotify?.(message, tone); },
      ...(options.onPanelDirtyChange ? { setPanelDirty: options.onPanelDirtyChange } : {}),
    },
  };

  return hostApi;
}

export type AcquirePluginSlotParams = {
  plugin: Plugin;
  hostInfo: PluginHostInfo;
  revision: number;
  slotId: string;
  getContext: () => PluginHostContext;
  subscribeContext: (cb: (ctx: PluginHostContext) => void) => () => void;
  eventBus: PluginEventBus;
  allowSurface: boolean;
  timeoutMs?: number;
  onClosePanel?: () => void;
  onNotify?: (message: string, tone?: 'info' | 'success' | 'error') => void;
  onPanelDirtyChange?: (dirty: boolean) => void;
};

export type AcquiredPluginSlot = {
  mod: ClaudeWebPluginModule;
  hostApi: PluginHostApi;
  slotSignal: AbortSignal;
  release: () => void;
};

type ActivePluginInstance = {
  instanceKey: string;
  pluginName: string;
  controller: AbortController;
  styleManager: ReturnType<typeof createPluginStyleManager>;
  slots: Set<string>;
  activationPromise: Promise<ClaudeWebPluginModule> | null;
  activated: boolean;
  mod: ClaudeWebPluginModule | null;
};

function withLifecycleTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type PluginInstanceManager = {
  acquireSlot: (params: AcquirePluginSlotParams) => Promise<AcquiredPluginSlot>;
  forceDeactivate: (pluginName: string) => void;
  deactivateAll: () => void;
};

/**
 * Coordinates plugin lifecycle across all slots (`background`, `overlay`, `settings`, `tab`):
 * guarantees `activate()` executes once per live plugin instance (even if multiple slots mount
 * simultaneously or only `settings`/`tab` is mounted) and `deactivate()` runs once when the
 * final slot unmounts or the plugin is disabled/updated/uninstalled/logged out.
 */
export function createPluginInstanceManager(): PluginInstanceManager {
  const instances = new Map<string, ActivePluginInstance>();

  function teardownInstance(instance: ActivePluginInstance): void {
    if (instances.get(instance.pluginName) === instance) {
      instances.delete(instance.pluginName);
    }
    instance.controller.abort();
    if (instance.activated && instance.mod) {
      instance.activated = false;
      try {
        instance.mod.deactivate?.();
      } catch (err) {
        console.error(`[Plugin:${instance.pluginName}] deactivate() failed:`, err);
      }
    }
    instance.styleManager.clearAll();
    purgePluginStyles(instance.pluginName);
  }

  return {
    async acquireSlot(params: AcquirePluginSlotParams): Promise<AcquiredPluginSlot> {
      const {
        plugin,
        hostInfo,
        revision,
        slotId,
        getContext,
        subscribeContext,
        eventBus,
        allowSurface,
        timeoutMs = 10_000,
        onClosePanel,
        onNotify,
        onPanelDirtyChange,
      } = params;

      const entryFile = plugin.entry || 'index.js';
      const instanceKey = `${plugin.name}::${plugin.version}::${entryFile}::${revision}`;

      let instance = instances.get(plugin.name);
      if (instance && instance.instanceKey !== instanceKey) {
        teardownInstance(instance);
        instance = undefined;
      }

      if (!instance) {
        instance = {
          instanceKey,
          pluginName: plugin.name,
          controller: new AbortController(),
          styleManager: createPluginStyleManager(plugin.name),
          slots: new Set<string>(),
          activationPromise: null,
          activated: false,
          mod: null,
        };
        instances.set(plugin.name, instance);
      }

      const currentInstance = instance;
      currentInstance.slots.add(slotId);

      const slotController = new AbortController();
      const onPluginAbort = () => slotController.abort();
      if (currentInstance.controller.signal.aborted) {
        slotController.abort();
      } else {
        currentInstance.controller.signal.addEventListener('abort', onPluginAbort, { once: true });
      }

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        currentInstance.controller.signal.removeEventListener('abort', onPluginAbort);
        slotController.abort();
        currentInstance.slots.delete(slotId);
        if (currentInstance.slots.size === 0) {
          teardownInstance(currentInstance);
        }
      };

      try {
        if (!currentInstance.activationPromise) {
          const allowActivationSurface = allowSurface || (
            getPluginSlots(plugin).includes('background')
            && (!hostInfo.activeBackgroundPlugin || hostInfo.activeBackgroundPlugin === plugin.name)
          );
          const activationHostApi = createPluginHostApi({
            plugin,
            hostInfo,
            signal: currentInstance.controller.signal,
            getContext,
            subscribeContext,
            eventBus,
            styleManager: currentInstance.styleManager,
            allowSurface: allowActivationSurface,
            onClosePanel,
            onNotify,
            onPanelDirtyChange,
          });

          currentInstance.activationPromise = (async () => {
            const mod = await withLifecycleTimeout(
              loadPluginModule(plugin.name, entryFile, revision),
              timeoutMs,
              `Loading ${plugin.name}`,
            );
            if (currentInstance.controller.signal.aborted) {
              return mod;
            }
            currentInstance.mod = mod;
            if (typeof mod.activate === 'function') {
              await withLifecycleTimeout(
                Promise.resolve(mod.activate(activationHostApi)),
                timeoutMs,
                `Activating ${plugin.name}`,
              );
              if (currentInstance.controller.signal.aborted) {
                try {
                  mod.deactivate?.();
                } catch (err) {
                  console.error(`[Plugin:${plugin.name}] deactivate() after abort failed:`, err);
                }
                return mod;
              }
              currentInstance.activated = true;
            }
            return mod;
          })().catch((err) => {
            if (instances.get(plugin.name) === currentInstance) {
              currentInstance.activationPromise = null;
            }
            throw err;
          });
        }

        const mod = await currentInstance.activationPromise;
        const slotHostApi = createPluginHostApi({
          plugin,
          hostInfo,
          signal: slotController.signal,
          getContext,
          subscribeContext,
          eventBus,
          styleManager: currentInstance.styleManager,
          allowSurface,
          onClosePanel,
          onNotify,
          onPanelDirtyChange,
        });

        return {
          mod,
          hostApi: slotHostApi,
          slotSignal: slotController.signal,
          release,
        };
      } catch (err) {
        release();
        throw err;
      }
    },

    forceDeactivate(pluginName: string) {
      const instance = instances.get(pluginName);
      if (instance) {
        teardownInstance(instance);
      } else {
        purgePluginStyles(pluginName);
      }
      evictPluginModuleCache(pluginName);
    },

    deactivateAll() {
      for (const instance of [...instances.values()]) {
        teardownInstance(instance);
      }
      evictPluginModuleCache();
    },
  };
}
