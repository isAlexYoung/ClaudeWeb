import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  BookOpen,
  ExternalLink,
  GitBranch,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  ServerCrash,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';

import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import PluginIcon from '@/modules/plugins/PluginIcon';
import { getPluginSlots } from '@/modules/plugins/pluginRuntime';
import type { Plugin, PluginRuntimeState } from '@/shared/types';

const CUSTOM_PLUGINS_URL = 'https://github.com/isAlexYoung/ClaudeWeb/blob/main/doc/CUSTOM_PLUGINS.md';

/**
 * Plugins ClaudeWeb installs and drives itself: the usage plugin feeds the
 * composer's quota ring, so it is part of the system rather than something the
 * user manages here, and listing it would invite disabling the ring by accident.
 */
const SYSTEM_PLUGIN_NAMES = new Set(['claude-usage']);

/* ─── Toggle Switch ─────────────────────────────────────────────────────── */
function ToggleSwitch({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <label
      className={`relative inline-flex select-none items-center ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <div
        className={`
          relative h-5 w-9 rounded-full bg-muted transition-colors
          duration-200 after:absolute
          after:left-[2px] after:top-[2px] after:h-4 after:w-4
          after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200
          after:content-[''] peer-checked:bg-emerald-500
          peer-checked:after:translate-x-4
        `}
      />
    </label>
  );
}

/* ─── Server Dot ────────────────────────────────────────────────────────── */
function ServerDot({ running, t }: { running: boolean; t: any }) {
  if (!running) return null;
  return (
    <span className="relative flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        {t('pluginSettings.runningStatus')}
      </span>
    </span>
  );
}

/* ─── Plugin Card ───────────────────────────────────────────────────────── */
type PluginCardProps = {
  plugin: Plugin;
  index: number;
  isActiveBackground: boolean;
  runtimeState?: PluginRuntimeState;
  onToggle: (enabled: boolean) => void;
  onOpenPanel: () => void;
  onActivateBackground: () => void;
  onUpdate: () => void;
  onRestart: () => void;
  onUninstall: (removeData: boolean) => void;
  updating: boolean;
  restarting: boolean;
  confirmingUninstall: boolean;
  onCancelUninstall: () => void;
  backgroundConflictWith: string | null;
  onConfirmBackgroundTakeover: () => void;
  onCancelBackgroundTakeover: () => void;
  updateError: string | null;
};

function PluginCard({
  plugin,
  index,
  isActiveBackground,
  runtimeState,
  onToggle,
  onOpenPanel,
  onActivateBackground,
  onUpdate,
  onRestart,
  onUninstall,
  updating,
  restarting,
  confirmingUninstall,
  onCancelUninstall,
  backgroundConflictWith,
  onConfirmBackgroundTakeover,
  onCancelBackgroundTakeover,
  updateError,
}: PluginCardProps) {
  const { t } = useTranslation('settings');
  const [removeData, setRemoveData] = useState(false);

  const slots = getPluginSlots(plugin);
  const hasSettingsPanel = slots.includes('settings');
  const hasBackgroundSlot = slots.includes('background');
  const incompatible = plugin.compatible === false;
  const hasError = runtimeState?.status === 'failed' || Boolean(plugin.serverCircuitOpen) || Boolean(plugin.serverError);

  const accentColor = incompatible || hasError
    ? 'bg-amber-500'
    : plugin.enabled
      ? 'bg-emerald-500'
      : 'bg-muted-foreground/20';

  return (
    <div
      className="relative flex border-b border-border/50 py-1 transition-opacity duration-200"
      style={{
        opacity: plugin.enabled ? 1 : 0.65,
        animationDelay: `${index * 40}ms`,
      }}
    >
      {/* Left accent bar */}
      <div className={`w-[3px] flex-shrink-0 ${accentColor} transition-colors duration-300`} />

      <div className="min-w-0 flex-1 p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="h-5 w-5 flex-shrink-0 text-foreground/80">
              <PluginIcon
                pluginName={plugin.name}
                iconFile={plugin.icon}
                className="h-5 w-5 [&>svg]:h-full [&>svg]:w-full"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold leading-none text-foreground">
                  {plugin.displayName}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  v{plugin.version}
                </span>
                {slots.map((slot) => (
                  <span key={slot} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {slot}
                  </span>
                ))}
                {isActiveBackground && plugin.enabled && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                    {t('pluginSettings.activeBackgroundBadge', { defaultValue: 'Active background' })}
                  </span>
                )}
                {incompatible && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    {t('pluginSettings.incompatibleBadge', { defaultValue: 'Incompatible' })}
                  </span>
                )}
                <ServerDot running={!!plugin.serverRunning} t={t} />
              </div>
              {plugin.description && (
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  {plugin.description}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {plugin.author && (
                  <span className="text-xs text-muted-foreground/60">
                    {plugin.author}
                  </span>
                )}
                {plugin.repoUrl && (
                  <a
                    href={plugin.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
                  >
                    <GitBranch className="h-3 w-3" />
                    <span className="max-w-[200px] truncate">
                      {plugin.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
                    </span>
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {hasSettingsPanel && (
              <button
                type="button"
                onClick={onOpenPanel}
                disabled={!plugin.enabled || incompatible}
                title={
                  !plugin.enabled
                    ? t('pluginSettings.enableToOpenPanel', { defaultValue: 'Enable plugin to open its panel' })
                    : t('pluginSettings.openPanel', { defaultValue: 'Open Panel' })
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>{t('pluginSettings.openPanel', { defaultValue: 'Open Panel' })}</span>
              </button>
            )}

            {hasBackgroundSlot && plugin.enabled && !isActiveBackground && !incompatible && (
              <button
                type="button"
                onClick={onActivateBackground}
                title={t('pluginSettings.useAsBackground', { defaultValue: 'Use as active background' })}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Layers className="h-3 w-3" />
                <span>{t('pluginSettings.useAsBackgroundShort', { defaultValue: 'Use background' })}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onUpdate}
              disabled={updating || !plugin.repoUrl}
              title={plugin.repoUrl ? t('pluginSettings.pullLatest') : t('pluginSettings.noGitRemote')}
              aria-label={t('pluginSettings.pullLatest')}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              {updating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onUninstall(removeData)}
              title={confirmingUninstall ? t('pluginSettings.confirmUninstall') : t('pluginSettings.uninstallPlugin')}
              aria-label={t('pluginSettings.uninstallPlugin')}
              className={`rounded p-1.5 transition-colors ${confirmingUninstall
                ? 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30'
                : 'text-muted-foreground hover:bg-muted hover:text-red-500'
                }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            <ToggleSwitch
              checked={plugin.enabled}
              disabled={incompatible && !plugin.enabled}
              onChange={onToggle}
              ariaLabel={`${plugin.enabled ? t('pluginSettings.disable') : t('pluginSettings.enable')} ${plugin.displayName}`}
            />
          </div>
        </div>

        {/* Incompatibility reason */}
        {incompatible && plugin.incompatibilityReason && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{plugin.incompatibilityReason}</span>
          </div>
        )}

        {/* Runtime crash / server circuit-breaker recovery bar */}
        {hasError && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <ServerCrash className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">
                {plugin.serverCircuitOpen
                  ? t('pluginSettings.circuitOpenMessage', {
                      defaultValue: 'Plugin server restarted repeatedly and was paused.',
                    })
                  : runtimeState?.error || plugin.serverError}
              </span>
            </div>
            <button
              type="button"
              onClick={onRestart}
              disabled={restarting}
              className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {restarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              <span>{t('pluginSettings.retryRestart', { defaultValue: 'Restart' })}</span>
            </button>
          </div>
        )}

        {/* Background slot conflict confirmation */}
        {backgroundConflictWith && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3 text-sm">
            <span className="text-xs text-foreground">
              {t('pluginSettings.backgroundConflictMessage', {
                current: backgroundConflictWith,
                next: plugin.displayName,
                defaultValue: `"${backgroundConflictWith}" is currently providing the workspace background. Switch background to "${plugin.displayName}"?`,
              })}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={onCancelBackgroundTakeover}
                className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t('pluginSettings.cancel')}
              </button>
              <button
                type="button"
                onClick={onConfirmBackgroundTakeover}
                className="rounded bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90"
              >
                {t('pluginSettings.switchBackground', { defaultValue: 'Switch background' })}
              </button>
            </div>
          </div>
        )}

        {/* Confirm uninstall banner */}
        {confirmingUninstall && (
          <div className="mt-3 space-y-2 border-t border-border/50 pt-3 text-destructive">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-red-600 dark:text-red-400">
                {t('pluginSettings.confirmUninstallMessage', { name: plugin.displayName })}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setRemoveData(false);
                    onCancelUninstall();
                  }}
                  className="rounded border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t('pluginSettings.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => onUninstall(removeData)}
                  className="rounded border border-red-300 px-2.5 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                >
                  {t('pluginSettings.remove')}
                </button>
              </div>
            </div>
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={removeData}
                onChange={(e) => setRemoveData(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border"
              />
              <span>
                {t('pluginSettings.removePluginData', {
                  defaultValue: 'Also delete saved plugin data (wallpapers and settings)',
                })}
              </span>
            </label>
          </div>
        )}

        {/* Update error */}
        {updateError && (
          <div className="mt-2 flex items-center gap-1.5 text-sm text-red-500">
            <ServerCrash className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{updateError}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main Component ────────────────────────────────────────────────────── */
/** Used by the unified extensions installer, with the legacy full manager retained for existing consumers. */
export default function PluginSettingsTab({ installOnly = false, onInstalled }: { installOnly?: boolean; onInstalled?: () => void } = {}) {
  const { t } = useTranslation('settings');
  const {
    plugins: allPlugins,
    hostInfo,
    loading,
    safeMode,
    exitSafeMode,
    runtimeStates,
    clearBootBlocked,
    openPluginPanel,
    installPlugin,
    uninstallPlugin,
    updatePlugin,
    restartPlugin,
    togglePlugin,
    setActiveBackground,
  } = usePlugins();
  const plugins = allPlugins.filter((plugin) => !SYSTEM_PLUGIN_NAMES.has(plugin.name));

  // Repository URL being entered for a custom plugin.
  const [gitUrl, setGitUrl] = useState('');
  // Keep installation single-flight and show its progress.
  const [installing, setInstalling] = useState(false);
  // Show the latest install, toggle or removal failure on this page.
  const [installError, setInstallError] = useState<string | null>(null);
  // The installed plugin awaiting explicit removal confirmation.
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  // Pending background slot conflict awaiting explicit switch confirmation.
  const [backgroundConflict, setBackgroundConflict] = useState<{ pluginName: string; currentOwner: string } | null>(null);
  // Track independent updates without blocking other plugin controls.
  const [updatingPlugins, setUpdatingPlugins] = useState<Set<string>>(new Set());
  // Track independent restarts without blocking other plugin controls.
  const [restartingPlugins, setRestartingPlugins] = useState<Set<string>>(new Set());
  // Keep update failures next to their installed plugin.
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});

  const handleUpdate = async (name: string) => {
    setUpdatingPlugins((prev) => new Set(prev).add(name));
    setUpdateErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
    const result = await updatePlugin(name);
    if (!result.success) {
      setUpdateErrors((prev) => ({ ...prev, [name]: result.error || t('pluginSettings.updateFailed') }));
    }
    setUpdatingPlugins((prev) => { const next = new Set(prev); next.delete(name); return next; });
  };

  const handleRestart = async (plugin: Plugin) => {
    setRestartingPlugins((prev) => new Set(prev).add(plugin.name));
    setUpdateErrors((prev) => { const next = { ...prev }; delete next[plugin.name]; return next; });
    if (plugin.server) {
      const result = await restartPlugin(plugin.name);
      if (!result.success) {
        setUpdateErrors((prev) => ({ ...prev, [plugin.name]: result.error || t('pluginSettings.restartFailed', { defaultValue: 'Restart failed' }) }));
      }
    } else {
      clearBootBlocked(plugin.name);
    }
    setRestartingPlugins((prev) => { const next = new Set(prev); next.delete(plugin.name); return next; });
  };

  const handleInstall = async () => {
    if (installing || !gitUrl.trim()) return;
    setInstalling(true);
    setInstallError(null);
    const result = await installPlugin(gitUrl.trim());
    if (result.success) {
      setGitUrl('');
      onInstalled?.();
    } else {
      setInstallError(result.error || t('pluginSettings.installFailed'));
    }
    setInstalling(false);
  };

  const handleUninstall = async (name: string, removeData: boolean) => {
    if (confirmUninstall !== name) {
      setConfirmUninstall(name);
      return;
    }
    const result = await uninstallPlugin(name, removeData ? { removeData: true } : undefined);
    if (result.success) {
      setConfirmUninstall(null);
    } else {
      setInstallError(result.error || t('pluginSettings.uninstallFailed'));
      setConfirmUninstall(null);
    }
  };

  const renderPluginCard = (plugin: Plugin, index: number) => {
    const handleToggle = async (enabled: boolean) => {
      setInstallError(null);
      setBackgroundConflict(null);
      const r = await togglePlugin(plugin.name, enabled);
      if (!r.success) {
        if (r.code === 'BACKGROUND_SLOT_OCCUPIED' && r.activeBackgroundPlugin) {
          setBackgroundConflict({ pluginName: plugin.name, currentOwner: r.activeBackgroundPlugin });
          return;
        }
        setInstallError(r.error || t('pluginSettings.toggleFailed'));
      }
    };

    const handleConfirmTakeover = async () => {
      setBackgroundConflict(null);
      const r = await togglePlugin(plugin.name, true, { takeoverBackground: true });
      if (!r.success) {
        setInstallError(r.error || t('pluginSettings.toggleFailed'));
      }
    };

    const handleActivateBackground = async () => {
      setInstallError(null);
      const r = await setActiveBackground(plugin.name);
      if (!r.success) {
        setInstallError(r.error || t('pluginSettings.toggleFailed'));
      }
    };

    return (
      <PluginCard
        key={plugin.name}
        plugin={plugin}
        index={index}
        isActiveBackground={hostInfo.activeBackgroundPlugin === plugin.name}
        runtimeState={runtimeStates[plugin.name]}
        onToggle={(enabled) => void handleToggle(enabled)}
        onOpenPanel={() => openPluginPanel(plugin.name)}
        onActivateBackground={() => void handleActivateBackground()}
        onUpdate={() => void handleUpdate(plugin.name)}
        onRestart={() => void handleRestart(plugin)}
        onUninstall={(removeData) => void handleUninstall(plugin.name, removeData)}
        updating={updatingPlugins.has(plugin.name)}
        restarting={restartingPlugins.has(plugin.name)}
        confirmingUninstall={confirmUninstall === plugin.name}
        onCancelUninstall={() => setConfirmUninstall(null)}
        backgroundConflictWith={
          backgroundConflict?.pluginName === plugin.name ? backgroundConflict.currentOwner : null
        }
        onConfirmBackgroundTakeover={() => void handleConfirmTakeover()}
        onCancelBackgroundTakeover={() => setBackgroundConflict(null)}
        updateError={updateErrors[plugin.name] ?? null}
      />
    );
  };

  if (installOnly) return (
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void handleInstall(); }}>
      <label htmlFor="extension-plugin-url" className="block text-sm font-medium text-foreground">{t('extensions.pluginUrl')}</label>
      <div className="flex gap-2">
        <input id="extension-plugin-url" aria-label={t('pluginSettings.installAriaLabel')} value={gitUrl} onChange={event => setGitUrl(event.target.value)} placeholder="https://github.com/owner/plugin" disabled={installing} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <button type="submit" disabled={installing || !gitUrl.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{installing && <Loader2 className="h-4 w-4 animate-spin" />}{t('pluginSettings.installButton')}</button>
      </div>
      {installError && <p role="alert" className="text-sm text-destructive">{installError}</p>}
      <a href={CUSTOM_PLUGINS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><BookOpen className="h-3.5 w-3.5" />{t('pluginSettings.customPlugins')}<ExternalLink className="h-3 w-3" /></a>
    </form>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="mb-1 pr-28 text-base font-semibold text-foreground">
          {t('pluginSettings.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('pluginSettings.description')}
        </p>
      </div>

      {/* Safe Mode banner */}
      {safeMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4 flex-shrink-0" />
            <span>
              {t('pluginSettings.safeModeBanner', {
                defaultValue: 'Plugin Safe Mode is active — third-party plugins are paused.',
              })}
            </span>
          </div>
          <button
            type="button"
            onClick={exitSafeMode}
            className="rounded border border-amber-500/40 bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t('pluginSettings.exitSafeMode', { defaultValue: 'Resume plugins' })}
          </button>
        </div>
      )}

      {/* Install from Git — compact */}
      <div className="settings-composite-input flex items-center gap-0 rounded-lg bg-muted/40">
        <span className="flex-shrink-0 pl-3 pr-1 text-muted-foreground/40">
          <GitBranch className="h-3.5 w-3.5" />
        </span>
        <input
          type="text"
          value={gitUrl}
          onChange={(e) => {
            setGitUrl(e.target.value);
            setInstallError(null);
          }}
          placeholder={t('pluginSettings.installPlaceholder')}
          aria-label={t('pluginSettings.installAriaLabel')}
          className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleInstall();
          }}
        />
        <button
          onClick={handleInstall}
          disabled={installing || !gitUrl.trim()}
          className="flex-shrink-0 rounded-r-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {installing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            t('pluginSettings.installButton')
          )}
        </button>
      </div>

      <div className="-mt-4 flex flex-wrap items-center justify-between gap-2">
        <a
          href={CUSTOM_PLUGINS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <BookOpen className="h-3.5 w-3.5" />
          {t('pluginSettings.customPlugins')} <ExternalLink className="h-3 w-3" />
        </a>
        <span className="text-xs text-muted-foreground/70">
          {t('pluginSettings.securityWarning')}
        </span>
      </div>

      {installError && (
        <p className="-mt-4 text-sm text-red-500">{installError}</p>
      )}

      {/* Plugin sections */}
      <div className="extension-list border-y border-border/50">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('pluginSettings.scanningPlugins')}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {plugins.length ? plugins.map(renderPluginCard) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('pluginSettings.noPluginsInstalled')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
