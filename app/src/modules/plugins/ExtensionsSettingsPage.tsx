import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { McpServerFormModal, useMcpServers } from '@/modules/mcp';
import { ProviderSkills, useProviderSkills } from '@/modules/skills';
import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import PluginSettingsTab from '@/modules/plugins/PluginSettingsTab';
import ExtensionCard from '@/modules/plugins/ExtensionCard';
import RecommendedConnectors from '@/modules/plugins/RecommendedConnectors';
import { PluginLinkContext } from '@/modules/plugins/context/PluginLinkContext';
import { getPluginSlots } from '@/modules/plugins/pluginRuntime';
import { useExtensionTransitions } from '@/modules/plugins/hooks/useExtensionTransitions';
import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import type { McpFormState, McpProject, SettingsExtensionItem } from '@/shared/types';

const EMPTY_PROJECTS: McpProject[] = [];
const KIND_ORDER = { plugin: 0, mcp: 1, skill: 2 };

/** Used by Settings and the workspace PluginsPage to manage extensions with the same installers and actions. */
export default function ExtensionsSettingsPage({ currentProjects = EMPTY_PROJECTS, showRecommendations = false, onOpenBrowser }: { currentProjects?: McpProject[]; showRecommendations?: boolean; onOpenBrowser?: (url?: string) => void }) {
  const { t } = useTranslation('settings');
  // Outside links open in the built-in browser where this page can show it (the workspace Plugins page).
  const openInBrowser = useCallback((url: string) => onOpenBrowser?.(url), [onOpenBrowser]);
  const custom = usePlugins();
  const mcp = useMcpServers({ selectedProvider: 'claude', currentProjects });
  const skills = useProviderSkills({ selectedProvider: 'claude', currentProjects });
  // Discovery and installation have separate views so only installed items appear in the list.
  const [view, setView] = useState<'list' | 'install'>('list');
  // Search and category selection apply across both enabled and disabled groups.
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'mcp' | 'skill'>('all');
  // Each installation type reuses its existing validated installer.
  const [installKind, setInstallKind] = useState<'plugin' | 'mcp' | 'skill'>('plugin');
  // Independent mutations block duplicate clicks on their own card only.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  // Keep mutation errors beside the affected card.
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A full refresh waits for all three catalogs without blanking existing items.
  const [refreshing, setRefreshing] = useState(false);
  // Confirm removal and optional data deletion before writing to disk.
  const [removeTarget, setRemoveTarget] = useState<SettingsExtensionItem | null>(null);
  const [removeData, setRemoveData] = useState(false);
  // Another background owner must be explicitly replaced.
  const [conflict, setConflict] = useState<{ item: SettingsExtensionItem; owner: string } | null>(null);
  // HTTP connector links complement the advanced stdio / JSON form.
  const [connectorUrl, setConnectorUrl] = useState('');
  const [connectorName, setConnectorName] = useState('');
  const [installingConnector, setInstallingConnector] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  // Moving to a new group must preserve the initiating keyboard user's focus.
  const focusAfterMove = useRef<string | null>(null);

  const items = useMemo<SettingsExtensionItem[]>(() => [
    ...custom.plugins.filter(plugin => plugin.name !== 'claude-usage').map(source => ({ id: `plugin:${source.name}`, kind: 'plugin' as const, name: source.displayName || source.name, description: source.description, enabled: source.enabled, source })),
    ...mcp.servers.map(source => ({ id: `mcp:${source.scope}:${source.workspacePath || ''}:${source.name}`, kind: 'mcp' as const, name: source.name, description: source.name.endsWith('-pc-files') ? t('extensions.localFilesDescription') : t('extensions.mcpDescription'), enabled: source.enabled !== false, source })),
    ...skills.skills.map(source => ({ id: `skill:${source.sourcePath}`, kind: 'skill' as const, name: source.name, description: source.description, enabled: source.enabled !== false, source })),
  ].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name)), [custom.plugins, mcp.servers, skills.skills, t]);
  const visible = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return items.filter(item => (filter === 'all' || item.kind === filter) && (!text || `${item.name} ${item.description}`.toLocaleLowerCase().includes(text)));
  }, [filter, items, query]);
  const membership = `${view}|${visible.map(item => `${item.id}:${item.enabled}`).join('|')}`;
  const listRef = useExtensionTransitions(membership);
  useEffect(() => {
    if (!focusAfterMove.current || pending.has(focusAfterMove.current)) return;
    const card = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-extension-id]') ?? []).find(node => node.dataset.extensionId === focusAfterMove.current);
    card?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus({ preventScroll: true });
    focusAfterMove.current = null;
  }, [listRef, membership, pending]);

  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await Promise.allSettled([custom.refreshPlugins(), mcp.refreshServers({ force: true }), skills.refreshSkills({ force: true })]); }
    finally { setRefreshing(false); }
  };
  const finishInstall = () => { setFilter('all'); setQuery(''); setView('list'); void refreshAll(); };
  const runAction = async (item: SettingsExtensionItem, action: () => Promise<void>) => {
    if (pendingRef.current.has(item.id)) return;
    pendingRef.current.add(item.id); setPending(new Set(pendingRef.current));
    setErrors(previous => { const next = { ...previous }; delete next[item.id]; return next; });
    try { await action(); }
    catch (error) { focusAfterMove.current = null; setErrors(previous => ({ ...previous, [item.id]: error instanceof Error ? error.message : t('extensions.actionFailed') })); }
    finally { pendingRef.current.delete(item.id); setPending(new Set(pendingRef.current)); }
  };
  const toggle = (item: SettingsExtensionItem, enabled: boolean, takeover = false) => runAction(item, async () => {
    focusAfterMove.current = item.id;
    if (item.kind === 'plugin') {
      const result = await custom.togglePlugin(item.source.name, enabled, takeover ? { takeoverBackground: true } : undefined);
      if (!result.success) {
        if (result.code === 'BACKGROUND_SLOT_OCCUPIED' && result.activeBackgroundPlugin) { focusAfterMove.current = null; setConflict({ item, owner: result.activeBackgroundPlugin }); return; }
        throw new Error(result.error || t('pluginSettings.toggleFailed'));
      }
    } else if (item.kind === 'mcp') await mcp.toggleServer(item.source, enabled);
    else await skills.toggleSkill(item.source, enabled);
  });
  const refreshItem = (item: SettingsExtensionItem) => runAction(item, async () => {
    if (item.kind === 'plugin') {
      const failed = custom.runtimeStates[item.source.name]?.status === 'failed' || item.source.serverCircuitOpen;
      if (failed) {
        if (item.source.server) {
          const result = await custom.restartPlugin(item.source.name);
          if (!result.success) throw new Error(result.error || t('extensions.actionFailed'));
        } else custom.clearBootBlocked(item.source.name);
      } else if (!item.source.bundled) {
        const result = await custom.updatePlugin(item.source.name);
        if (!result.success) throw new Error(result.error || t('pluginSettings.updateFailed'));
      } else await custom.refreshPlugins();
    } else if (item.kind === 'mcp') await mcp.refreshServers({ force: true });
    else await skills.refreshSkills({ force: true });
  });
  const remove = (item: SettingsExtensionItem) => runAction(item, async () => {
    if (item.kind === 'plugin') {
      const result = await custom.uninstallPlugin(item.source.name, removeData ? { removeData: true } : undefined);
      if (!result.success) throw new Error(result.error || t('pluginSettings.uninstallFailed'));
    } else if (item.kind === 'mcp') await mcp.deleteServer(item.source, { confirm: false });
    else await skills.removeSkill(item.source);
    setRemoveTarget(null);
  });
  const installConnector = async () => {
    if (installingConnector) return;
    setInstallingConnector(true); setConnectorError(null);
    try {
      const address = new URL(connectorUrl.trim());
      if (!['http:', 'https:'].includes(address.protocol)) throw new Error(t('extensions.invalidConnectorUrl'));
      const baseName = connectorName.trim() || address.hostname.replace(/[^a-zA-Z0-9_-]/g, '-');
      let name = baseName;
      let suffix = 2;
      while (mcp.servers.some(server => server.scope === 'user' && server.name === name)) {
        if (connectorName.trim()) throw new Error(t('extensions.connectorExists'));
        name = `${baseName}-${suffix++}`;
      }
      const form: McpFormState = { name, url: address.href, transport: 'http', scope: 'user', workspacePath: '', command: '', args: [], env: {}, cwd: '', headers: {}, envVars: [], bearerTokenEnvVar: '', envHttpHeaders: {}, importMode: 'form', jsonInput: '' };
      await mcp.submitForm(form, null);
      setConnectorUrl(''); setConnectorName(''); finishInstall();
    } catch (error) { setConnectorError(error instanceof Error ? error.message : t('extensions.actionFailed')); }
    finally { setInstallingConnector(false); }
  };
  const loading = custom.loading || mcp.isLoading || skills.isLoading;
  const loadErrors = [custom.pluginsError, mcp.loadError, mcp.deleteError, skills.loadError].filter(Boolean);
  const renderCard = (item: SettingsExtensionItem) => {
    const plugin = item.kind === 'plugin' ? item.source : null;
    return <ExtensionCard key={item.id} item={item} busy={pending.has(item.id)} error={errors[item.id] || (plugin ? custom.runtimeStates[plugin.name]?.error ?? undefined : undefined)}
      canOpenPanel={Boolean(plugin && getPluginSlots(plugin).includes('settings'))}
      canRemove={item.kind === 'plugin' ? !item.source.bundled : item.kind !== 'mcp' || !item.source.name.startsWith('claudeweb-')}
      canActivateBackground={Boolean(plugin?.enabled && getPluginSlots(plugin).includes('background') && custom.hostInfo.activeBackgroundPlugin !== plugin.name)}
      onOpenPanel={() => { if (plugin) custom.openPluginPanel(plugin.name); }} onRefresh={() => void refreshItem(item)}
      onInspect={item.kind === 'mcp' && !item.source.name.startsWith('claudeweb-') ? () => mcp.openForm(item.source) : undefined}
      onRemove={() => { setRemoveTarget(item); setRemoveData(false); }} onToggle={enabled => void toggle(item, enabled)}
      onActivateBackground={() => void runAction(item, async () => { if (plugin) { const result = await custom.setActiveBackground(plugin.name); if (!result.success) throw new Error(result.error || t('extensions.actionFailed')); } })} />;
  };

  return (
    <PluginLinkContext.Provider value={onOpenBrowser ? openInBrowser : null}>
    <div className="min-w-0 space-y-5" data-testid="extensions-settings-page">
      {view === 'list' ? <>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[140px] flex-1 basis-full sm:basis-0">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label={t('extensions.search')} placeholder={t('extensions.search')} value={query} onChange={event => setQuery(event.target.value)} className="h-10 rounded-xl border-transparent bg-muted/50 pl-9 shadow-none" />
          </div>
          <div className="flex items-center rounded-xl bg-muted/50 p-1" role="group" aria-label={t('extensions.filter')}>
            {(['all', 'mcp', 'skill'] as const).map(key => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={`rounded-lg px-3 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring ${filter === key ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{t(`extensions.filters.${key}`)}</button>)}
          </div>
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => void refreshAll()} disabled={refreshing} aria-label={t('skillsPage.refresh')} title={t('skillsPage.refresh')}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></Button>
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => { setInstallKind(filter === 'skill' ? 'skill' : filter === 'mcp' ? 'mcp' : 'plugin'); setView('install'); }} aria-label={t('extensions.add')} title={t('extensions.add')}><Plus className="h-5 w-5" /></Button>
        </div>
        {custom.safeMode && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-xs"><span>{t('pluginSettings.safeModeBanner')}</span><Button variant="outline" size="sm" onClick={custom.exitSafeMode}>{t('pluginSettings.exitSafeMode')}</Button></div>}
        {loadErrors.length > 0 && <p role="alert" className="text-xs text-destructive">{[...new Set(loadErrors)].join(' · ')}</p>}
        {showRecommendations && <h2 className="text-base font-medium">{t('extensions.yourExtensions')}</h2>}
        <div ref={listRef} className="space-y-6" aria-busy={loading || undefined}>
          {([true, false] as const).map(enabled => {
            const group = visible.filter(item => item.enabled === enabled);
            return group.length ? <section key={String(enabled)} aria-label={t(enabled ? 'extensions.enabled' : 'extensions.disabled')}>
              <h3 className="mb-1 text-sm font-medium text-foreground">{t(enabled ? 'extensions.enabled' : 'extensions.disabled')}</h3><div>{group.map(renderCard)}</div>
            </section> : null;
          })}
          {!visible.length && <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">{loading ? <><Loader2 className="h-4 w-4 animate-spin" />{t('extensions.loading')}</> : query.trim() || filter !== 'all' ? t('extensions.noMatches') : t('extensions.empty')}</div>}
        </div>
        {showRecommendations && filter !== 'skill' && <RecommendedConnectors query={query} onOpenBrowser={onOpenBrowser} />}
      </> : <>
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setView('list')} aria-label={t('extensions.back')}><ArrowLeft className="h-4 w-4" /></Button><h3 className="text-base font-medium">{t('extensions.add')}</h3></div>
        <div className="flex gap-1 border-b border-border/50 pb-3" role="group" aria-label={t('extensions.installType')}>
          {(['plugin', 'mcp', 'skill'] as const).map(kind => <Button key={kind} variant={installKind === kind ? 'secondary' : 'ghost'} size="sm" aria-pressed={installKind === kind} onClick={() => setInstallKind(kind)}>{t(`extensions.types.${kind}`)}</Button>)}
        </div>
        {installKind === 'plugin' && <PluginSettingsTab installOnly onInstalled={finishInstall} />}
        {installKind === 'skill' && <ProviderSkills selectedProvider="claude" currentProjects={currentProjects} installOnly onInstalled={finishInstall} />}
        {installKind === 'mcp' && <div className="space-y-5"><form className="space-y-4" onSubmit={event => { event.preventDefault(); void installConnector(); }}>
          <label className="block space-y-2 text-sm"><span>{t('extensions.connectorName')}</span><Input value={connectorName} onChange={event => setConnectorName(event.target.value)} disabled={installingConnector} placeholder={t('extensions.connectorNamePlaceholder')} /></label>
          <label className="block space-y-2 text-sm"><span>{t('extensions.connectorUrl')}</span><Input type="url" required value={connectorUrl} onChange={event => setConnectorUrl(event.target.value)} disabled={installingConnector} placeholder="https://example.com/mcp" /></label>
          <div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" size="sm" onClick={() => mcp.openForm()}>{t('extensions.advancedConnector')}</Button><Button type="submit" disabled={installingConnector || !connectorUrl.trim()}>{installingConnector && <Loader2 className="h-4 w-4 animate-spin" />}{t('pluginSettings.installButton')}</Button></div>
          {connectorError && <p role="alert" className="text-sm text-destructive">{connectorError}</p>}
        </form></div>}
      </>}
      {mcp.serverForm && <McpServerFormModal provider="claude" editingServer={mcp.serverForm.editingServer} currentProjects={currentProjects} onClose={mcp.closeForm} onSubmit={async (form, editing) => { await mcp.submitForm(form, editing); finishInstall(); }} />}
      <Dialog open={Boolean(removeTarget)} onOpenChange={open => { if (!open) setRemoveTarget(null); }}><DialogContent><DialogTitle>{t('extensions.remove')}</DialogTitle><div className="space-y-4 p-5">
        <h3 className="text-base font-medium">{t('extensions.removeTitle', { name: removeTarget?.name })}</h3>
        {removeTarget?.kind === 'plugin' && <label className="flex items-start gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={removeData} onChange={event => setRemoveData(event.target.checked)} className="mt-1 accent-primary" />{t('pluginSettings.removePluginData')}</label>}
        {removeTarget && errors[removeTarget.id] && <p role="alert" className="text-sm text-destructive">{errors[removeTarget.id]}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={Boolean(removeTarget && pending.has(removeTarget.id))}>{t('common:cancel')}</Button><Button variant="destructive" disabled={Boolean(removeTarget && pending.has(removeTarget.id))} onClick={() => { if (removeTarget) void remove(removeTarget); }}>{t('extensions.remove')}</Button></div>
      </div></DialogContent></Dialog>
      <Dialog open={Boolean(conflict)} onOpenChange={open => { if (!open) setConflict(null); }}><DialogContent><DialogTitle>{t('extensions.switchBackground')}</DialogTitle><div className="space-y-4 p-5"><p className="text-sm">{t('extensions.backgroundConflict', { name: conflict?.owner })}</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConflict(null)}>{t('common:cancel')}</Button><Button onClick={() => { if (conflict) { void toggle(conflict.item, true, true); setConflict(null); } }}>{t('extensions.switchBackground')}</Button></div></div></DialogContent></Dialog>
    </div>
    </PluginLinkContext.Provider>
  );
}
