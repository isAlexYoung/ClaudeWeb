import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';

import { useTheme } from '@/shared/context/ThemeContext';
import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import PluginIcon from '@/modules/plugins/PluginIcon';
import {
  buildPluginHostContext,
  getPluginSlots,
} from '@/modules/plugins/pluginRuntime';
import type { AcquiredPluginSlot } from '@/modules/plugins/pluginRuntime';
import type { PluginHostContext } from '@/shared/types';

/**
 * Host drawer / modal container for plugins declaring the `settings` slot.
 * Mounted inside ProtectedRoute above Settings so drawer-mode plugins (like
 * Wallpaper) can reveal the live workspace underneath while editing.
 */
export default function PluginSettingsPanel() {
  const { t, i18n } = useTranslation('settings');
  const { isDarkMode, themeMode } = useTheme();
  const {
    plugins,
    hostInfo,
    pluginRevisions,
    workspaceContext,
    openPanelPlugin,
    closePluginPanel,
    setPanelDirty,
    panelClosePromptOpen,
    cancelPanelClosePrompt,
    confirmDiscardAndClosePanel,
    eventBus,
    instanceManager,
    notifyPlugin,
  } = usePlugins();

  const plugin = useMemo(
    () => (openPanelPlugin ? plugins.find((p) => p.name === openPanelPlugin) ?? null : null),
    [openPanelPlugin, plugins],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef<PluginHostContext>(
    buildPluginHostContext({
      isDarkMode,
      themeMode,
      locale: i18n.language,
      route: 'settings',
      project: workspaceContext.project,
      session: workspaceContext.session,
    }),
  );
  const contextListenersRef = useRef(new Set<(ctx: PluginHostContext) => void>());

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

  useEffect(() => {
    const nextCtx = buildPluginHostContext({
      isDarkMode,
      themeMode,
      locale: i18n.language,
      route: 'settings',
      project: workspaceContext.project,
      session: workspaceContext.session,
    });
    contextRef.current = nextCtx;
    for (const listener of contextListenersRef.current) {
      try { listener(nextCtx); } catch { /* isolate plugin errors */ }
    }
  }, [i18n.language, isDarkMode, themeMode, workspaceContext]);

  // Escape closes this panel (respecting dirty-draft confirmation) before Settings sees it.
  useEffect(() => {
    if (!plugin) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (panelClosePromptOpen) {
        cancelPanelClosePrompt();
      } else {
        closePluginPanel(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [cancelPanelClosePrompt, closePluginPanel, panelClosePromptOpen, plugin]);

  // Keep refs current so refreshing the plugin list (new object identity, same version/entry)
  // never tears down or interrupts an actively open settings panel.
  const pluginRef = useRef(plugin);
  const hostInfoRef = useRef(hostInfo);
  useEffect(() => {
    pluginRef.current = plugin;
    hostInfoRef.current = hostInfo;
  }, [hostInfo, plugin]);

  const pluginName = plugin?.name ?? null;
  const pluginVersion = plugin?.version ?? null;
  const pluginEntry = plugin?.entry ?? 'index.js';
  const pluginEnabled = Boolean(plugin?.enabled);
  const pluginCompatible = plugin?.compatible !== false;
  const pluginPublicAppearance = Boolean(plugin?.publicAppearance);
  const activeBackgroundPlugin = hostInfo.activeBackgroundPlugin;
  const revision = pluginName ? (pluginRevisions[pluginName] ?? 0) : 0;

  useEffect(() => {
    const container = containerRef.current;
    const currentPlugin = pluginRef.current;
    if (!pluginName || !currentPlugin || !pluginEnabled || !pluginCompatible || !container) return;

    let disposed = false;
    let acquired: AcquiredPluginSlot | null = null;
    let didMount = false;

    setLoading(true);
    setError(null);
    setPanelDirty(false);

    (async () => {
      try {
        const isActiveBackground =
          getPluginSlots(currentPlugin).includes('background')
          && (!activeBackgroundPlugin || activeBackgroundPlugin === pluginName);

        const handle = await instanceManager.acquireSlot({
          plugin: currentPlugin,
          hostInfo: hostInfoRef.current,
          revision,
          slotId: 'settings',
          getContext,
          subscribeContext,
          eventBus,
          allowSurface: isActiveBackground,
          onClosePanel: () => closePluginPanel(true),
          onNotify: notifyPlugin,
          onPanelDirtyChange: setPanelDirty,
        });
        if (disposed || handle.slotSignal.aborted) {
          handle.release();
          return;
        }
        acquired = handle;

        if (typeof handle.mod.mountSettings === 'function') {
          await handle.mod.mountSettings(container, handle.hostApi);
          didMount = true;
        } else if (typeof handle.mod.mount === 'function') {
          await handle.mod.mount(container, handle.hostApi);
          didMount = true;
        } else {
          throw new Error(
            t('pluginSettings.noSettingsEntry', {
              defaultValue: 'This plugin does not export a mountSettings() panel.',
            }),
          );
        }

        if (disposed || handle.slotSignal.aborted) {
          if (didMount) {
            try {
              if (typeof handle.mod.unmountSettings === 'function') {
                handle.mod.unmountSettings(container);
              } else {
                handle.mod.unmount?.(container);
              }
            } catch (err) {
              console.error(`[Plugin:${pluginName}] unmountSettings() after abort failed:`, err);
            }
          }
          container.innerHTML = '';
          handle.release();
          acquired = null;
          return;
        }

        setLoading(false);
      } catch (err) {
        if (disposed) return;
        console.error(`[Plugin:${pluginName}] Failed to open settings panel:`, err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();

    return () => {
      disposed = true;
      if (acquired) {
        if (didMount) {
          try {
            if (typeof acquired.mod.unmountSettings === 'function') {
              acquired.mod.unmountSettings(container);
            } else {
              acquired.mod.unmount?.(container);
            }
          } catch (err) {
            console.error(`[Plugin:${pluginName}] unmountSettings() failed:`, err);
          }
        }
        acquired.release();
        acquired = null;
      }
      container.innerHTML = '';
      setPanelDirty(false);
    };
  }, [
    activeBackgroundPlugin,
    closePluginPanel,
    eventBus,
    getContext,
    instanceManager,
    notifyPlugin,
    pluginCompatible,
    pluginEnabled,
    pluginEntry,
    pluginName,
    pluginPublicAppearance,
    pluginVersion,
    revision,
    setPanelDirty,
    subscribeContext,
    t,
  ]);

  if (!plugin) return null;

  const isModal = plugin.panel?.mode === 'modal';
  const drawerWidth = Math.min(680, Math.max(320, plugin.panel?.width ?? 440));
  const title = plugin.panel?.title || plugin.displayName;

  return (
    <div
      data-escape-layer="true"
      className={`fixed inset-0 z-[10020] flex ${
        isModal
          ? 'items-center justify-center bg-background/70 p-4 backdrop-blur-sm'
          : 'justify-end bg-black/15'
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closePluginPanel(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={isModal ? undefined : { width: `min(${drawerWidth}px, 100vw)` }}
        className={`relative flex flex-col overflow-hidden border-border bg-background/95 text-foreground shadow-2xl backdrop-blur-xl ${
          isModal
            ? 'h-[min(85vh,760px)] w-full max-w-2xl rounded-xl border'
            : 'h-full border-l'
        }`}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="h-5 w-5 flex-shrink-0 text-foreground/80">
              <PluginIcon
                pluginName={plugin.name}
                iconFile={plugin.icon}
                className="h-5 w-5 [&>svg]:h-full [&>svg]:w-full"
              />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {plugin.displayName} · v{plugin.version}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => closePluginPanel(false)}
            aria-label={t('pluginSettings.closePanel', { defaultValue: 'Close plugin panel' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Unsaved draft confirmation bar */}
        {panelClosePromptOpen && (
          <div
            role="alertdialog"
            aria-label={t('pluginSettings.unsavedPanelTitle', { defaultValue: 'Unsaved preview changes' })}
            className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs"
          >
            <span className="text-foreground">
              {t('pluginSettings.unsavedPanelPrompt', {
                defaultValue: 'Discard unsaved preview changes and close this panel?',
              })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelPanelClosePrompt}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
              >
                {t('pluginSettings.keepEditing', { defaultValue: 'Keep editing' })}
              </button>
              <button
                type="button"
                onClick={confirmDiscardAndClosePanel}
                className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700"
              >
                {t('pluginSettings.discardAndClose', { defaultValue: 'Discard & close' })}
              </button>
            </div>
          </div>
        )}

        {/* Mounted plugin panel body */}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div ref={containerRef} className="h-full w-full" />
          {loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('pluginSettings.loadingPanel', { defaultValue: 'Loading plugin panel…' })}</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-sm font-medium text-red-500">
                {t('pluginSettings.panelLoadFailed', { defaultValue: 'Could not open plugin panel' })}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
