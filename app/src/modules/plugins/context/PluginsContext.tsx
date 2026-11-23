import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api, readApiErrorMessage } from '@/shared/api';
import {
  DEFAULT_HOST_INFO,
  clearBootBlockedPlugin,
  clearPluginSafeMode,
  createPluginEventBus,
  evictPluginModuleCache,
  purgePluginStyles,
  readBootBlockedPlugins,
  readPluginSafeMode,
} from '@/modules/plugins/pluginRuntime';
import type { PluginEventBus } from '@/modules/plugins/pluginRuntime';
import type { Plugin, PluginHostInfo, PluginRuntimeState } from '@/shared/types';

export type TogglePluginResult = {
  success: boolean;
  error: string | null;
  code?: string;
  activeBackgroundPlugin?: string;
};

export type PluginToast = {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
};

type PluginsContextValue = {
  plugins: Plugin[];
  hostInfo: PluginHostInfo;
  loading: boolean;
  pluginsError: string | null;
  safeMode: boolean;
  exitSafeMode: () => void;
  bootBlockedPlugins: ReadonlySet<string>;
  clearBootBlocked: (name: string) => void;
  runtimeStates: Record<string, PluginRuntimeState>;
  setPluginRuntimeState: (name: string, state: PluginRuntimeState | null) => void;
  pluginRevisions: Record<string, number>;
  openPanelPlugin: string | null;
  openPluginPanel: (name: string) => void;
  closePluginPanel: (force?: boolean) => void;
  panelDirty: boolean;
  setPanelDirty: (dirty: boolean) => void;
  panelClosePromptOpen: boolean;
  cancelPanelClosePrompt: () => void;
  confirmDiscardAndClosePanel: () => void;
  toast: PluginToast | null;
  notifyPlugin: (message: string, tone?: 'info' | 'success' | 'error') => void;
  eventBus: PluginEventBus;
  refreshPlugins: () => Promise<void>;
  installPlugin: (url: string) => Promise<{ success: boolean; error?: string }>;
  uninstallPlugin: (name: string, options?: { removeData?: boolean }) => Promise<{ success: boolean; error?: string }>;
  updatePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  restartPlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  togglePlugin: (
    name: string,
    enabled: boolean,
    options?: { takeoverBackground?: boolean },
  ) => Promise<TogglePluginResult>;
  setActiveBackground: (name: string | null) => Promise<{ success: boolean; error?: string }>;
};

const PluginsContext = createContext<PluginsContextValue | null>(null);

export function usePlugins() {
  const context = useContext(PluginsContext);
  if (!context) {
    throw new Error('usePlugins must be used within a PluginsProvider');
  }
  return context;
}

/** Optional hook for shared shells (like Settings) that may be tested without PluginsProvider. */
export function useOptionalPlugins() {
  return useContext(PluginsContext);
}

/** Mounted by the app root so the plugins and project-workspace modules can read and mutate installed plugins through usePlugins. */
export function PluginsProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [hostInfo, setHostInfo] = useState<PluginHostInfo>(DEFAULT_HOST_INFO);
  const [loading, setLoading] = useState(true);
  const [pluginsError, setPluginsError] = useState<string | null>(null);
  const [safeMode, setSafeMode] = useState<boolean>(() => readPluginSafeMode());
  const [bootBlockedPlugins, setBootBlockedPlugins] = useState<Set<string>>(() => readBootBlockedPlugins());
  const [runtimeStates, setRuntimeStates] = useState<Record<string, PluginRuntimeState>>({});
  const [pluginRevisions, setPluginRevisions] = useState<Record<string, number>>({});
  const [openPanelPlugin, setOpenPanelPlugin] = useState<string | null>(null);
  const [panelDirty, setPanelDirtyState] = useState(false);
  const [panelClosePromptOpen, setPanelClosePromptOpen] = useState(false);
  const [toast, setToast] = useState<PluginToast | null>(null);

  const panelDirtyRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const eventBus = useMemo(() => createPluginEventBus(), []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    eventBus.clear();
  }, [eventBus]);

  const setPanelDirty = useCallback((dirty: boolean) => {
    panelDirtyRef.current = dirty;
    setPanelDirtyState(dirty);
  }, []);

  const notifyPlugin = useCallback((message: string, tone: 'info' | 'success' | 'error' = 'info') => {
    const trimmed = String(message || '').trim();
    if (!trimmed) return;
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ id: Date.now(), message: trimmed, tone });
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 3500);
  }, []);

  const openPluginPanel = useCallback((name: string) => {
    panelDirtyRef.current = false;
    setPanelDirtyState(false);
    setPanelClosePromptOpen(false);
    setOpenPanelPlugin(name);
  }, []);

  const closePluginPanel = useCallback((force = false) => {
    if (!force && panelDirtyRef.current) {
      setPanelClosePromptOpen(true);
      return;
    }
    panelDirtyRef.current = false;
    setPanelDirtyState(false);
    setPanelClosePromptOpen(false);
    setOpenPanelPlugin(null);
  }, []);

  const cancelPanelClosePrompt = useCallback(() => {
    setPanelClosePromptOpen(false);
  }, []);

  const confirmDiscardAndClosePanel = useCallback(() => {
    panelDirtyRef.current = false;
    setPanelDirtyState(false);
    setPanelClosePromptOpen(false);
    setOpenPanelPlugin(null);
  }, []);

  const bumpPluginRevision = useCallback((name: string) => {
    setPluginRevisions((prev) => ({ ...prev, [name]: (prev[name] ?? 0) + 1 }));
  }, []);

  const setPluginRuntimeState = useCallback((name: string, state: PluginRuntimeState | null) => {
    setRuntimeStates((prev) => {
      if (state === null) {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      const existing = prev[name];
      if (
        existing
        && existing.status === state.status
        && existing.error === state.error
        && existing.bootBlocked === state.bootBlocked
      ) {
        return prev;
      }
      return { ...prev, [name]: state };
    });
  }, []);

  const exitSafeMode = useCallback(() => {
    clearPluginSafeMode();
    setSafeMode(false);
  }, []);

  const clearBootBlocked = useCallback((name: string) => {
    clearBootBlockedPlugin(name);
    setBootBlockedPlugins((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    bumpPluginRevision(name);
  }, [bumpPluginRevision]);

  const refreshPlugins = useCallback(async () => {
    try {
      const res = await api.plugins.list();
      if (res.ok) {
        const data = await res.json();
        setPlugins(data.plugins || []);
        if (data.host && typeof data.host === 'object') {
          setHostInfo({
            version: typeof data.host.version === 'string' ? data.host.version : DEFAULT_HOST_INFO.version,
            apiVersion: typeof data.host.apiVersion === 'number' ? data.host.apiVersion : DEFAULT_HOST_INFO.apiVersion,
            capabilities: Array.isArray(data.host.capabilities)
              ? data.host.capabilities
              : DEFAULT_HOST_INFO.capabilities,
            activeBackgroundPlugin: typeof data.host.activeBackgroundPlugin === 'string'
              ? data.host.activeBackgroundPlugin
              : null,
          });
        }
        setPluginsError(null);
      } else {
        let errorMessage = `Failed to fetch plugins (${res.status})`;
        try {
          const data = await res.json();
          errorMessage = readApiErrorMessage(data) ?? errorMessage;
        } catch {
          errorMessage = res.statusText || errorMessage;
        }
        setPluginsError(errorMessage);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch plugins';
      setPluginsError(message);
      console.error('[Plugins] Failed to fetch plugins:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlugins();
  }, [refreshPlugins]);

  const installPlugin = useCallback(async (url: string) => {
    try {
      const res = await api.plugins.install(url);
      const data = await res.json();
      if (res.ok) {
        await refreshPlugins();
        return { success: true };
      }
      return { success: false, error: readApiErrorMessage(data) ?? 'Install failed' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Install failed' };
    }
  }, [refreshPlugins]);

  const uninstallPlugin = useCallback(async (name: string, options?: { removeData?: boolean }) => {
    try {
      if (openPanelPlugin === name) {
        closePluginPanel(true);
      }
      const res = await api.plugins.uninstall(name, options);
      const data = await res.json();
      if (res.ok) {
        evictPluginModuleCache(name);
        purgePluginStyles(name);
        clearBootBlockedPlugin(name);
        setPluginRuntimeState(name, null);
        await refreshPlugins();
        return { success: true };
      }
      return { success: false, error: readApiErrorMessage(data) ?? 'Uninstall failed' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Uninstall failed' };
    }
  }, [closePluginPanel, openPanelPlugin, refreshPlugins, setPluginRuntimeState]);

  const updatePlugin = useCallback(async (name: string) => {
    try {
      // Force-close an open settings drawer for this plugin before updating so it does not hold stale bundles.
      if (openPanelPlugin === name) {
        closePluginPanel(true);
      }
      const res = await api.plugins.update(name);
      const data = await res.json();
      if (res.ok) {
        evictPluginModuleCache(name);
        clearBootBlockedPlugin(name);
        setBootBlockedPlugins((prev) => {
          if (!prev.has(name)) return prev;
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        bumpPluginRevision(name);
        await refreshPlugins();
        return { success: true };
      }
      return { success: false, error: readApiErrorMessage(data) ?? 'Update failed' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Update failed' };
    }
  }, [bumpPluginRevision, closePluginPanel, openPanelPlugin, refreshPlugins]);

  const restartPlugin = useCallback(async (name: string) => {
    try {
      const res = await api.plugins.restart(name);
      const data = await res.json();
      if (res.ok) {
        clearBootBlocked(name);
        await refreshPlugins();
        return { success: true };
      }
      return { success: false, error: readApiErrorMessage(data) ?? 'Restart failed' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Restart failed' };
    }
  }, [clearBootBlocked, refreshPlugins]);

  const togglePlugin = useCallback(async (
    name: string,
    enabled: boolean,
    options?: { takeoverBackground?: boolean },
  ): Promise<TogglePluginResult> => {
    try {
      if (!enabled && openPanelPlugin === name) {
        closePluginPanel(true);
      }
      const res = await api.plugins.toggle(name, enabled, options);
      if (!res.ok) {
        let errorMessage = `Toggle failed (${res.status})`;
        let code: string | undefined;
        let activeBackgroundPlugin: string | undefined;
        try {
          const data = await res.json();
          errorMessage = readApiErrorMessage(data) ?? errorMessage;
          if (typeof data?.error?.code === 'string') {
            code = data.error.code;
          }
          if (typeof data?.error?.details?.activePlugin === 'string') {
            activeBackgroundPlugin = data.error.details.activePlugin;
          } else if (typeof data?.error?.details?.activeBackgroundPlugin === 'string') {
            activeBackgroundPlugin = data.error.details.activeBackgroundPlugin;
          }
        } catch {
          errorMessage = res.statusText || errorMessage;
        }
        return { success: false, error: errorMessage, code, activeBackgroundPlugin };
      }
      if (!enabled) {
        evictPluginModuleCache(name);
        purgePluginStyles(name);
      }
      await refreshPlugins();
      return { success: true, error: null };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Toggle failed' };
    }
  }, [closePluginPanel, openPanelPlugin, refreshPlugins]);

  const setActiveBackground = useCallback(async (name: string | null) => {
    try {
      const res = await api.plugins.setActiveBackground(name);
      const data = await res.json();
      if (res.ok) {
        await refreshPlugins();
        return { success: true };
      }
      return { success: false, error: readApiErrorMessage(data) ?? 'Failed to switch active background plugin' };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to switch active background plugin',
      };
    }
  }, [refreshPlugins]);

  // Built once per change: an inline object would re-render every consumer on
  // any render of this provider.
  const value = useMemo(
    () => ({
      plugins,
      hostInfo,
      loading,
      pluginsError,
      safeMode,
      exitSafeMode,
      bootBlockedPlugins,
      clearBootBlocked,
      runtimeStates,
      setPluginRuntimeState,
      pluginRevisions,
      openPanelPlugin,
      openPluginPanel,
      closePluginPanel,
      panelDirty,
      setPanelDirty,
      panelClosePromptOpen,
      cancelPanelClosePrompt,
      confirmDiscardAndClosePanel,
      toast,
      notifyPlugin,
      eventBus,
      refreshPlugins,
      installPlugin,
      uninstallPlugin,
      updatePlugin,
      restartPlugin,
      togglePlugin,
      setActiveBackground,
    }),
    [
      bootBlockedPlugins,
      cancelPanelClosePrompt,
      clearBootBlocked,
      closePluginPanel,
      confirmDiscardAndClosePanel,
      eventBus,
      exitSafeMode,
      hostInfo,
      installPlugin,
      loading,
      notifyPlugin,
      openPanelPlugin,
      openPluginPanel,
      panelClosePromptOpen,
      panelDirty,
      pluginRevisions,
      plugins,
      pluginsError,
      refreshPlugins,
      restartPlugin,
      runtimeStates,
      safeMode,
      setActiveBackground,
      setPanelDirty,
      setPluginRuntimeState,
      toast,
      togglePlugin,
      uninstallPlugin,
      updatePlugin,
    ],
  );

  return (
    <PluginsContext.Provider value={value}>
      {children}
    </PluginsContext.Provider>
  );
}
