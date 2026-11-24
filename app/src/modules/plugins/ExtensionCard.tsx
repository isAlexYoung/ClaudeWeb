import { Layers, Loader2, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import PluginIcon from '@/modules/plugins/PluginIcon';
import type { SettingsExtensionItem } from '@/shared/types';

type ExtensionCardProps = {
  item: SettingsExtensionItem;
  busy: boolean;
  error?: string;
  canOpenPanel: boolean;
  canRemove: boolean;
  canActivateBackground: boolean;
  onOpenPanel: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
  onActivateBackground: () => void;
  onInspect?: () => void;
};

/** Used by ExtensionsSettingsPage to give plugins, MCP and skills identical cards and controls. */
export default function ExtensionCard({ item, busy, error, canOpenPanel, canRemove, canActivateBackground, onOpenPanel, onRefresh, onRemove, onToggle, onActivateBackground, onInspect }: ExtensionCardProps) {
  const { t } = useTranslation('settings');
  const initial = Array.from(item.name.trim())[0]?.toLocaleUpperCase() || '?';
  const type = item.kind === 'plugin' ? t('extensions.types.plugin') : item.kind === 'mcp' ? 'MCP' : 'Skills';
  const pluginError = item.kind === 'plugin'
    ? item.source.incompatibilityReason || item.source.serverError
    : null;
  const incompatible = item.kind === 'plugin' && item.source.compatible === false;
  const iconButton = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

  return (
    <article data-extension-id={item.id} data-extension-kind={item.kind} aria-label={item.name} className={`extension-card flex min-w-0 flex-col gap-3 border-b border-border/50 px-1 py-4 transition-opacity duration-200 sm:flex-row sm:items-center sm:gap-4 ${item.enabled ? '' : 'opacity-80'}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-lg font-medium text-foreground/75">
          {item.kind === 'plugin' ? <PluginIcon pluginName={item.source.name} iconFile={item.source.icon} fallbackText={initial} className="flex h-6 w-6 items-center justify-center [&>svg]:h-6 [&>svg]:w-6" /> : initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h4 className="break-words text-sm font-medium leading-5 text-foreground">{onInspect ? <button type="button" onClick={onInspect} disabled={busy} aria-label={`${t('extensions.edit')} ${item.name}`} className="text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">{item.name}</button> : item.name}</h4>
            <span className="text-[10px] font-medium leading-4 text-muted-foreground">{type}</span>
          </div>
          {item.description && <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground" title={item.description}>{item.description}</p>}
          {(error || pluginError) && <p role="alert" className="mt-1 break-words text-xs leading-5 text-destructive">{error || pluginError}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1 pl-[52px] sm:pl-0">
        {canActivateBackground && <button type="button" className={iconButton} disabled={busy} onClick={onActivateBackground} aria-label={`${t('pluginSettings.useAsBackground')} ${item.name}`} title={t('pluginSettings.useAsBackground')}><Layers className="h-3.5 w-3.5" /></button>}
        {canOpenPanel && <button type="button" onClick={onOpenPanel} disabled={busy || !item.enabled || incompatible} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><SlidersHorizontal className="h-3.5 w-3.5" />{t('pluginSettings.openPanel')}</button>}
        <button type="button" className={iconButton} disabled={busy} onClick={onRefresh} aria-label={`${t('extensions.refresh')} ${item.name}`} title={t('extensions.refresh')}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</button>
        {canRemove && <button type="button" className={`${iconButton} hover:text-destructive`} disabled={busy} onClick={onRemove} aria-label={`${t('extensions.remove')} ${item.name}`} title={t('extensions.remove')}><Trash2 className="h-3.5 w-3.5" /></button>}
        <button type="button" role="switch" aria-checked={item.enabled} aria-label={`${t('extensions.enable')} ${item.name}`} disabled={busy || incompatible} onClick={() => onToggle(!item.enabled)} className={`relative ml-2 h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40 ${item.enabled ? 'bg-primary' : 'bg-muted-foreground/25'}`}>
          <span className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 motion-reduce:transition-none ${item.enabled ? 'translate-x-[18px]' : 'translate-x-0'}`} />
        </button>
      </div>
    </article>
  );
}
