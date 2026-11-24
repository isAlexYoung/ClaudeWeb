import { useId, useState } from 'react';
import { Copy, ExternalLink, Globe, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import { copyTextToClipboard } from '@/shared/utils';

const CONNECTORS_URL = 'https://claude.ai/customize/connectors';

// These are account connectors, not git packages or arbitrary MCP URLs to install locally.
const CONNECTORS = [
  { id: 'drive', name: 'Google Drive', provider: 'Google' },
  { id: 'gmail', name: 'Gmail', provider: 'Google' },
  { id: 'calendar', name: 'Google Calendar', provider: 'Google' },
  { id: 'microsoft', name: 'Microsoft 365', provider: 'Anthropic' },
] as const;

function ConnectorIcon({ id }: { id: typeof CONNECTORS[number]['id'] }) {
  return <svg viewBox="0 0 32 32" className="mt-1 h-8 w-8 shrink-0" aria-hidden="true">
    {id === 'drive' && <><path fill="#0F9D58" d="M11 3h10L10 22H0z" /><path fill="#F4B400" d="m21 3 11 19H22L11 3z" /><path fill="#4285F4" d="M0 22h32l-5 8H5z" /></>}
    {id === 'gmail' && <><path fill="#4285F4" d="M2 8h6v20H2z" /><path fill="#34A853" d="M24 8h6v20h-6z" /><path fill="#EA4335" d="m2 6 14 11L30 6v8L16 25 2 14z" /><path fill="#C5221F" d="M2 6h6v13l-6-5z" /><path fill="#FBBC04" d="M24 6h6v8l-6 5z" /></>}
    {id === 'calendar' && <><rect x="2" y="3" width="28" height="27" rx="3" fill="#4285F4" /><path fill="#1967D2" d="M2 3h28v7H2z" /><path fill="#FFF" d="M7 10h18v15H7z" /><text x="16" y="22" textAnchor="middle" fontFamily="sans-serif" fontSize="12" fontWeight="600" fill="#4285F4">31</text></>}
    {id === 'microsoft' && <><path fill="#F25022" d="M1 1h14v14H1z" /><path fill="#7FBA00" d="M17 1h14v14H17z" /><path fill="#00A4EF" d="M1 17h14v14H1z" /><path fill="#FFB900" d="M17 17h14v14H17z" /></>}
  </svg>;
}

/** Used by the workspace extension manager to discover account connectors without claiming local installation. */
export default function RecommendedConnectors({ query, onOpenBrowser }: { query: string; onOpenBrowser?: () => void }) {
  const { t } = useTranslation('settings');
  const titleId = useId();
  // A recommendation opens authorization guidance; only the provider can confirm a successful connection.
  const [selected, setSelected] = useState<typeof CONNECTORS[number] | null>(null);
  // Clipboard permissions vary on self-hosted HTTP pages; keep the URL selectable even if copying fails.
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null);
  const text = query.trim().toLocaleLowerCase();
  const visible = CONNECTORS.filter(item => `${item.name} ${item.provider} ${t(`extensions.recommended.${item.id}`)}`.toLocaleLowerCase().includes(text));
  if (!visible.length) return null;

  return <section aria-label={t('extensions.popular')} className="space-y-3 pt-5">
    <h2 className="text-base font-medium">{t('extensions.popular')}</h2>
    <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
      {visible.map(item => <article key={item.id} aria-label={item.name} className="flex min-w-0 items-start gap-4 border-b border-border/50 py-5">
        <ConnectorIcon id={item.id} />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium">{item.name}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`extensions.recommended.${item.id}`)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('extensions.connectorBy', { provider: item.provider })}</p>
        </div>
        <Button variant="secondary" size="icon" className="mt-1 h-8 w-8 shrink-0 rounded-lg" aria-label={t('extensions.connectName', { name: item.name })} onClick={() => { setSelected(item); setCopyStatus(null); }}><Plus className="h-4 w-4" /></Button>
      </article>)}
    </div>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto" aria-labelledby={titleId}>
        <DialogTitle id={titleId}>{t('extensions.connectName', { name: selected?.name })}</DialogTitle>
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
          <h3 className="text-base font-medium">{t('extensions.connectName', { name: selected?.name })}</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('common:buttons.close')} onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-5 p-5 text-sm">
          <p className="leading-relaxed text-muted-foreground">{t('extensions.accountConnectorIntro')}</p>
          <div className="space-y-2">
            <label className="block space-y-2"><span>{t('extensions.connectionLink')}</span><Input readOnly value={CONNECTORS_URL} onFocus={event => event.target.select()} /></label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={async () => setCopyStatus(await copyTextToClipboard(CONNECTORS_URL) ? 'copied' : 'failed')}><Copy className="h-4 w-4" />{t('extensions.copyConnectionLink')}</Button>
              {onOpenBrowser && <Button variant="outline" size="sm" onClick={() => { setSelected(null); onOpenBrowser(); }}><Globe className="h-4 w-4" />{t('extensions.openWorkspaceBrowser')}</Button>}
            </div>
            {copyStatus && <p role="status" className="text-xs text-muted-foreground">{t(copyStatus === 'copied' ? 'extensions.linkCopied' : 'extensions.copyLinkFailed')}</p>}
            <p className="text-xs leading-relaxed text-muted-foreground">{t('extensions.manualConnectionHint')}</p>
          </div>
          <ol className="list-decimal space-y-3 pl-5 leading-relaxed">
            <li>{t('extensions.accountConnectStep', { name: selected?.name })}</li>
            <li>{t('extensions.cliLoginStep')} <code className="rounded bg-muted px-1.5 py-0.5">/login</code></li>
            <li>{t('extensions.cliVerifyStep')} <code className="rounded bg-muted px-1.5 py-0.5">/mcp</code></li>
          </ol>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('extensions.accountConnectorLimits')}</p>
          {selected?.id === 'microsoft' && <p className="text-xs leading-relaxed text-muted-foreground">{t('extensions.microsoftAccount')}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" href="https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai" target="_blank" rel="noopener noreferrer">{t('extensions.connectionDocs')}<ExternalLink className="h-3.5 w-3.5" /></a>
            <a className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={CONNECTORS_URL} target="_blank" rel="noopener noreferrer">{t('extensions.openConnectors')}<ExternalLink className="h-4 w-4" /></a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
