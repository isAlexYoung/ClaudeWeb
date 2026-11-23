import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import {
  buildPluginHostContext,
  createPluginHostApi,
  createPluginStyleManager,
  loadPluginModule,
} from '@/modules/plugins/pluginRuntime';
import type { ClaudeWebPluginModule, PluginHostContext, Project, ProjectSession, ThemeMode } from '@/shared/types';

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
  const { plugins, hostInfo, safeMode, pluginRevisions, eventBus, notifyPlugin } = usePlugins();

  // Stable refs so effects don't need context values in their dep arrays
  const contextRef = useRef<PluginHostContext>(
    buildContext(isDarkMode, themeMode, i18n.language, selectedProject, selectedSession),
  );
  const contextCallbacksRef = useRef<Set<(ctx: PluginHostContext) => void>>(new Set());
  const moduleRef = useRef<ClaudeWebPluginModule | null>(null);

  const plugin = plugins.find((p) => p.name === pluginName);
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

  const hostInfoRef = useRef(hostInfo);
  hostInfoRef.current = hostInfo;

  useEffect(() => {
    // Drop any previous plugin's error before this load attempt starts, so a
    // stale overlay never covers a different (or successfully loaded) plugin.
    setLoadError(null);
    if (!containerRef.current || !plugin?.enabled) return;

    if (safeMode) {
      setLoadError(
        t('settings:pluginSettings.safeModeTabBlocked', {
          defaultValue: 'Plugin Safe Mode is active. Resume plugins to open this tab.',
        }),
      );
      return;
    }

    if (plugin.compatible === false) {
      setLoadError(
        plugin.incompatibilityReason
        || t('settings:pluginSettings.incompatible', { defaultValue: 'Incompatible with this ClaudeWeb version.' }),
      );
      return;
    }

    let active = true;
    const container = containerRef.current;
    const entryFile = plugin.entry ?? 'index.js';
    const contextCallbacks = contextCallbacksRef.current;
    const controller = new AbortController();
    const styleManager = createPluginStyleManager(`${pluginName}:tab`);

    (async () => {
      try {
        const mod = await loadPluginModule(pluginName, entryFile, revision);
        if (!active || !containerRef.current || controller.signal.aborted) return;

        moduleRef.current = mod;

        const pluginHostApi = createPluginHostApi({
          plugin,
          hostInfo: hostInfoRef.current,
          signal: controller.signal,
          getContext,
          subscribeContext,
          eventBus,
          styleManager,
          allowSurface: false,
          onNotify: notifyPlugin,
        });

        await mod.mount?.(container, pluginHostApi);
        if (!active) {
          try { mod.unmount?.(container); } catch { /* ignore */ }
          moduleRef.current = null;
          return;
        }
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        console.error(`[Plugin:${pluginName}] Failed to load:`, err);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      active = false;
      controller.abort();
      try { moduleRef.current?.unmount?.(container); } catch { /* ignore */ }
      container.innerHTML = '';
      styleManager.clearAll();
      contextCallbacks.clear();
      moduleRef.current = null;
    };
  }, [
    eventBus,
    getContext,
    notifyPlugin,
    plugin,
    pluginName,
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
