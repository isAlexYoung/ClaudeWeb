import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import { buildPluginHostContext } from '@/modules/plugins/pluginRuntime';
import type { AcquiredPluginSlot } from '@/modules/plugins/pluginRuntime';
import type { PluginHostContext, Project, ProjectSession, ThemeMode } from '@/shared/types';

type PluginTabContentProps = {
  pluginName: string;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
};

function buildContext(
  isDarkMode: boolean,
  themeMode: ThemeMode,
  locale: string,
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): PluginHostContext {
  return buildPluginHostContext({
    isDarkMode,
    themeMode,
    locale,
    route: 'workspace',
    // Plugin contract historically used `name` for the project identifier; we
    // keep that key and populate it from the DB `projectId` so external plugins
    // continue to receive a stable opaque id.
    project: selectedProject
      ? {
        name: selectedProject.projectId,
        path: selectedProject.fullPath || selectedProject.path || '',
      }
      : null,
    session: selectedSession
      ? {
        id: selectedSession.id,
        title: selectedSession.title || selectedSession.name || selectedSession.id,
      }
      : null,
  });
}

/** Rendered by the project-workspace module to host a plugin's own UI inside its workspace tab. */
export default function PluginTabContent({
  pluginName,
  selectedProject,
  selectedSession,
}: PluginTabContentProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { isDarkMode, themeMode } = useTheme();
  const {
    plugins,
    hostInfo,
    safeMode,
    pluginRevisions,
    eventBus,
    instanceManager,
    notifyPlugin,
  } = usePlugins();

  // Stable refs so effects don't need context values or list-refreshed plugin object identities in dep arrays.
  const contextRef = useRef<PluginHostContext>(
    buildContext(isDarkMode, themeMode, i18n.language, selectedProject, selectedSession),
  );
  const contextCallbacksRef = useRef<Set<(ctx: PluginHostContext) => void>>(new Set());

  const plugin = plugins.find((p) => p.name === pluginName) ?? null;
  const pluginRef = useRef(plugin);
  const hostInfoRef = useRef(hostInfo);
  useEffect(() => {
    pluginRef.current = plugin;
    hostInfoRef.current = hostInfo;
  }, [hostInfo, plugin]);

  const pluginVersion = plugin?.version ?? null;
  const pluginEntry = plugin?.entry ?? 'index.js';
  const pluginEnabled = Boolean(plugin?.enabled);
  const pluginCompatible = plugin?.compatible !== false;
  const pluginIncompatReason = plugin?.incompatibilityReason ?? null;
  const revision = pluginRevisions[pluginName] ?? 0;

  const getContext = useMemo(() => () => contextRef.current, []);
  const subscribeContext = useMemo(
    () => (cb: (ctx: PluginHostContext) => void) => {
      contextCallbacksRef.current.add(cb);
      return () => {
        contextCallbacksRef.current.delete(cb);
      };
    },
    [],
  );

  // Keep contextRef current and notify the mounted plugin on every context change
  useEffect(() => {
    const ctx = buildContext(isDarkMode, themeMode, i18n.language, selectedProject, selectedSession);
    contextRef.current = ctx;

    for (const cb of contextCallbacksRef.current) {
      try { cb(ctx); } catch { /* plugin error — ignore */ }
    }
  }, [i18n.language, isDarkMode, selectedProject, selectedSession, themeMode]);

  useEffect(() => {
    // Drop any previous plugin's error before this load attempt starts, so a
    // stale overlay never covers a different (or successfully loaded) plugin.
    setLoadError(null);
    const currentPlugin = pluginRef.current;
    if (!containerRef.current || !currentPlugin || !pluginEnabled) return;

    if (safeMode) {
      setLoadError(
        t('settings:pluginSettings.safeModeTabBlocked', {
          defaultValue: 'Plugin Safe Mode is active. Resume plugins to open this tab.',
        }),
      );
      return;
    }

    if (!pluginCompatible) {
      setLoadError(
        pluginIncompatReason
        || t('settings:pluginSettings.incompatible', { defaultValue: 'Incompatible with this ClaudeWeb version.' }),
      );
      return;
    }

    let active = true;
    const container = containerRef.current;
    const contextCallbacks = contextCallbacksRef.current;
    let acquired: AcquiredPluginSlot | null = null;
    let didMount = false;

    (async () => {
      try {
        const handle = await instanceManager.acquireSlot({
          plugin: currentPlugin,
          hostInfo: hostInfoRef.current,
          revision,
          slotId: `tab:${pluginName}`,
          getContext,
          subscribeContext,
          eventBus,
          allowSurface: false,
          onNotify: notifyPlugin,
        });
        if (!active || !containerRef.current || handle.slotSignal.aborted) {
          handle.release();
          return;
        }
        acquired = handle;

        await handle.mod.mount?.(container, handle.hostApi);
        didMount = true;
        if (!active) {
          try { handle.mod.unmount?.(container); } catch { /* ignore */ }
          handle.release();
          acquired = null;
        }
      } catch (err) {
        if (!active) return;
        console.error(`[Plugin:${pluginName}] Failed to load:`, err);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      active = false;
      if (acquired) {
        if (didMount) {
          try { acquired.mod.unmount?.(container); } catch { /* ignore */ }
        }
        acquired.release();
        acquired = null;
      }
      container.innerHTML = '';
      contextCallbacks.clear();
    };
  }, [
    eventBus,
    getContext,
    instanceManager,
    notifyPlugin,
    pluginCompatible,
    pluginEnabled,
    pluginEntry,
    pluginIncompatReason,
    pluginName,
    pluginVersion,
    revision,
    safeMode,
    subscribeContext,
    t,
  ]);

  return (
    <div className="relative h-full w-full overflow-auto">
      <div ref={containerRef} className="h-full w-full overflow-auto" />
      {loadError && (
        <div className="absolute inset-0 p-4 text-[13px] text-red-600">
          {t('common:misc.pluginLoadFailed', { error: loadError })}
        </div>
      )}
    </div>
  );
}
