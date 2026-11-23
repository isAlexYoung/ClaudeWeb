import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

import { useTheme } from '@/shared/context/ThemeContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import {
  applyWallpaperSurfaceVars,
  buildPluginHostContext,
  getPluginSlots,
  markPluginBootInFlight,
} from '@/modules/plugins/pluginRuntime';
import type { AcquiredPluginSlot } from '@/modules/plugins/pluginRuntime';
import type { Plugin, PluginHostContext } from '@/shared/types';

const ACTIVATION_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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

type MountedSlotProps = {
  plugin: Plugin;
  slot: 'background' | 'overlay';
  revision: number;
  getContext: () => PluginHostContext;
  subscribeContext: (cb: (ctx: PluginHostContext) => void) => () => void;
  onBackgroundMount: (pluginName: string) => void;
  onBackgroundUnmount: (pluginName: string) => void;
};

function MountedPluginSlot({
  plugin,
  slot,
  revision,
  getContext,
  subscribeContext,
  onBackgroundMount,
  onBackgroundUnmount,
}: MountedSlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    hostInfo,
    eventBus,
    instanceManager,
    notifyPlugin,
    setPluginRuntimeState,
  } = usePlugins();

  const hostInfoRef = useRef(hostInfo);
  const pluginRef = useRef(plugin);
  useEffect(() => {
    hostInfoRef.current = hostInfo;
    pluginRef.current = plugin;
  }, [hostInfo, plugin]);

  const pluginName = plugin.name;
  const pluginVersion = plugin.version;
  const pluginEntry = plugin.entry || 'index.js';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const currentPlugin = pluginRef.current;
    let disposed = false;
    let acquired: AcquiredPluginSlot | null = null;
    let didMountLayer = false;

    if (slot === 'background') {
      onBackgroundMount(pluginName);
    }

    setPluginRuntimeState(pluginName, { status: 'loading', error: null, bootBlocked: false });
    markPluginBootInFlight(pluginName, true);

    (async () => {
      try {
        const handle = await instanceManager.acquireSlot({
          plugin: currentPlugin,
          hostInfo: hostInfoRef.current,
          revision,
          slotId: `layer:${slot}`,
          getContext,
          subscribeContext,
          eventBus,
          allowSurface: slot === 'background',
          timeoutMs: ACTIVATION_TIMEOUT_MS,
          onNotify: notifyPlugin,
        });
        if (disposed || handle.slotSignal.aborted) {
          handle.release();
          return;
        }
        acquired = handle;

        if (typeof handle.mod.mountLayer === 'function') {
          await withTimeout(
            Promise.resolve(handle.mod.mountLayer(slot, container, handle.hostApi)),
            ACTIVATION_TIMEOUT_MS,
            `Mounting ${pluginName} (${slot})`,
          );
          didMountLayer = true;
        } else if (typeof handle.mod.mount === 'function') {
          await withTimeout(
            Promise.resolve(handle.mod.mount(container, handle.hostApi)),
            ACTIVATION_TIMEOUT_MS,
            `Mounting ${pluginName}`,
          );
          didMountLayer = true;
        }

        if (disposed || handle.slotSignal.aborted) {
          if (didMountLayer) {
            try {
              if (typeof handle.mod.unmountLayer === 'function') {
                handle.mod.unmountLayer(slot, container);
              } else {
                handle.mod.unmount?.(container);
              }
            } catch (err) {
              console.error(`[Plugin:${pluginName}] unmountLayer(${slot}) after abort failed:`, err);
            }
          }
          container.innerHTML = '';
          handle.release();
          acquired = null;
          return;
        }

        markPluginBootInFlight(pluginName, false);
        setPluginRuntimeState(pluginName, { status: 'active', error: null, bootBlocked: false });
      } catch (err) {
        markPluginBootInFlight(pluginName, false);
        if (disposed) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Plugin:${pluginName}] Failed in ${slot} slot:`, err);
        if (slot === 'background') {
          onBackgroundUnmount(pluginName);
        }
        setPluginRuntimeState(pluginName, { status: 'failed', error: message, bootBlocked: false });
      }
    })();

    return () => {
      disposed = true;
      markPluginBootInFlight(pluginName, false);

      if (acquired) {
        if (didMountLayer) {
          try {
            if (typeof acquired.mod.unmountLayer === 'function') {
              acquired.mod.unmountLayer(slot, container);
            } else {
              acquired.mod.unmount?.(container);
            }
          } catch (err) {
            console.error(`[Plugin:${pluginName}] unmountLayer(${slot}) failed:`, err);
          }
        }
        acquired.release();
        acquired = null;
      }

      container.innerHTML = '';

      if (slot === 'background') {
        onBackgroundUnmount(pluginName);
      }
    };
  }, [
    eventBus,
    getContext,
    instanceManager,
    notifyPlugin,
    onBackgroundMount,
    onBackgroundUnmount,
    pluginEntry,
    pluginName,
    pluginVersion,
    revision,
    setPluginRuntimeState,
    slot,
    subscribeContext,
  ]);

  return (
    <div
      ref={containerRef}
      data-cw-plugin-slot={slot}
      data-cw-plugin-name={plugin.name}
      className="pointer-events-none absolute inset-0"
    />
  );
}

/**
 * Mounted once inside ProtectedRoute so background and overlay plugins only run
 * while authenticated and are torn down completely on sign-out or session expiry.
 */
export default function GlobalPluginsRunner() {
  const { t, i18n } = useTranslation('settings');
  const { isDarkMode, themeMode } = useTheme();
  const { subscribe, connectionStatus } = useWebSocket();
  const {
    plugins,
    hostInfo,
    safeMode,
    exitSafeMode,
    bootBlockedPlugins,
    pluginRevisions,
    workspaceContext,
    toast,
    eventBus,
    instanceManager,
    refreshPlugins,
    setPluginRuntimeState,
  } = usePlugins();

  const contextRef = useRef<PluginHostContext>(
    buildPluginHostContext({
      isDarkMode,
      themeMode,
      locale: i18n.language,
      route: workspaceContext.route,
      project: workspaceContext.project,
      session: workspaceContext.session,
    }),
  );
  const focusedSessionIdRef = useRef<string | null>(workspaceContext.session?.id ?? null);
  const contextListenersRef = useRef(new Set<(ctx: PluginHostContext) => void>());
  const activeBackgroundOwnerRef = useRef<string | null>(null);

  const getContext = useMemo(() => () => contextRef.current, []);
  const subscribeContext = useMemo(
    () => (cb: (ctx: PluginHostContext) => void) => {
      contextListenersRef.current.add(cb);
      return () => {
        contextListenersRef.current.delete(cb);
      };
    },
    [],
  );

  // Refresh plugin list right after authentication succeeds so PluginsProvider has authenticated data.
  useEffect(() => {
    void refreshPlugins();
  }, [refreshPlugins]);

  // Clear all plugin DOM/surface side effects on sign-out (when ProtectedRoute unmounts this runner).
  useEffect(() => () => {
    activeBackgroundOwnerRef.current = null;
    applyWallpaperSurfaceVars(null);
    instanceManager.deactivateAll();
    eventBus.clear();
  }, [eventBus, instanceManager]);

  // Broadcast theme, locale, route, project, and session changes to every active global plugin.
  useEffect(() => {
    focusedSessionIdRef.current = workspaceContext.session?.id ?? null;
    const nextCtx = buildPluginHostContext({
      isDarkMode,
      themeMode,
      locale: i18n.language,
      route: workspaceContext.route,
      project: workspaceContext.project,
      session: workspaceContext.session,
    });
    contextRef.current = nextCtx;
    for (const listener of contextListenersRef.current) {
      try { listener(nextCtx); } catch { /* isolate plugin callback errors */ }
    }
  }, [i18n.language, isDarkMode, themeMode, workspaceContext]);

  // Bridge WebSocket frames and connection status into the normalized PluginEventBus with live focusedSessionId.
  useEffect(() => {
    eventBus.setConnectionStatus(connectionStatus);
  }, [connectionStatus, eventBus]);

  useEffect(() => subscribe((frame) => {
    eventBus.ingestServerEvent(frame, focusedSessionIdRef.current);
  }), [eventBus, subscribe]);

  // Surface boot-blocked plugins in runtimeStates so Settings > Plugins can show a clear Retry action.
  useEffect(() => {
    for (const name of bootBlockedPlugins) {
      setPluginRuntimeState(name, {
        status: 'failed',
        error: t('pluginSettings.bootBlockedMessage', {
          defaultValue: 'Skipped after a previous startup crash. Click Restart to try again.',
        }),
        bootBlocked: true,
      });
    }
  }, [bootBlockedPlugins, setPluginRuntimeState, t]);

  const activeBackgroundPlugin = useMemo(() => {
    if (safeMode) return null;
    const candidates = plugins.filter(
      (plugin) =>
        plugin.enabled
        && plugin.compatible !== false
        && !bootBlockedPlugins.has(plugin.name)
        && getPluginSlots(plugin).includes('background'),
    );
    if (candidates.length === 0) return null;
    if (hostInfo.activeBackgroundPlugin) {
      return candidates.find((plugin) => plugin.name === hostInfo.activeBackgroundPlugin) ?? null;
    }
    return candidates[0];
  }, [bootBlockedPlugins, hostInfo.activeBackgroundPlugin, plugins, safeMode]);

  const activeOverlayPlugins = useMemo(() => {
    if (safeMode) return [];
    return plugins
      .filter(
        (plugin) =>
          plugin.enabled
          && plugin.compatible !== false
          && !bootBlockedPlugins.has(plugin.name)
          && getPluginSlots(plugin).includes('overlay'),
      )
      .sort((a, b) => (a.overlayOrder ?? 100) - (b.overlayOrder ?? 100) || a.name.localeCompare(b.name));
  }, [bootBlockedPlugins, plugins, safeMode]);

  const handleBackgroundMount = useMemo(
    () => (pluginName: string) => {
      activeBackgroundOwnerRef.current = pluginName;
    },
    [],
  );

  const handleBackgroundUnmount = useMemo(
    () => (pluginName: string) => {
      if (activeBackgroundOwnerRef.current === pluginName) {
        activeBackgroundOwnerRef.current = null;
        applyWallpaperSurfaceVars(null);
      }
    },
    [],
  );

  // If no background plugin is active (e.g. disabled, safe mode, or switched off), guarantee surface reset.
  useEffect(() => {
    if (!activeBackgroundPlugin) {
      activeBackgroundOwnerRef.current = null;
      applyWallpaperSurfaceVars(null);
    }
  }, [activeBackgroundPlugin]);

  return (
    <>
      {/* Background plugin slot: strictly single-active behind workspace surfaces */}
      <div
        id="cw-plugin-background-layer"
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        {activeBackgroundPlugin && (
          <MountedPluginSlot
            key={`${activeBackgroundPlugin.name}:${activeBackgroundPlugin.version}:${pluginRevisions[activeBackgroundPlugin.name] ?? 0}`}
            plugin={activeBackgroundPlugin}
            slot="background"
            revision={pluginRevisions[activeBackgroundPlugin.name] ?? 0}
            getContext={getContext}
            subscribeContext={subscribeContext}
            onBackgroundMount={handleBackgroundMount}
            onBackgroundUnmount={handleBackgroundUnmount}
          />
        )}
      </div>

      {/* Overlay plugin slot: deterministic z-order above workspace, below modals and approvals */}
      <div
        id="cw-plugin-overlay-layer"
        className="pointer-events-none fixed inset-0 z-[38] overflow-hidden"
      >
        {activeOverlayPlugins.map((plugin) => (
          <MountedPluginSlot
            key={`${plugin.name}:${plugin.version}:${pluginRevisions[plugin.name] ?? 0}`}
            plugin={plugin}
            slot="overlay"
            revision={pluginRevisions[plugin.name] ?? 0}
            getContext={getContext}
            subscribeContext={subscribeContext}
            onBackgroundMount={handleBackgroundMount}
            onBackgroundUnmount={handleBackgroundUnmount}
          />
        ))}
      </div>

      {/* Safe Mode recovery banner */}
      {safeMode && (
        <div
          role="status"
          className="fixed left-1/2 top-3 z-[10005] flex -translate-x-1/2 items-center gap-3 rounded-full border border-amber-500/40 bg-background/95 px-4 py-1.5 text-xs text-foreground shadow-lg backdrop-blur"
        >
          <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
          <span>
            {t('pluginSettings.safeModeBanner', {
              defaultValue: 'Plugin Safe Mode is active — third-party plugins are paused.',
            })}
          </span>
          <button
            type="button"
            onClick={exitSafeMode}
            className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
          >
            {t('pluginSettings.exitSafeMode', { defaultValue: 'Resume plugins' })}
          </button>
        </div>
      )}

      {/* Lightweight plugin toast for host.ui.notify(...) */}
      {toast && (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 left-1/2 z-[10030] -translate-x-1/2 rounded-lg border px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur ${
            toast.tone === 'error'
              ? 'border-red-500/40 bg-red-950/90 text-red-100'
              : toast.tone === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-100'
                : 'border-border bg-popover/95 text-popover-foreground'
          }`}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
