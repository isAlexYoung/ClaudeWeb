import { useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy, ExternalLink, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PluginLinkContext } from '@/modules/plugins/context/PluginLinkContext';
import { copyTextToClipboard } from '@/shared/utils';

type PluginLinkProps = {
  href: string;
  children: ReactNode;
  /** Classes of the link itself; the copy button sits right after it. */
  className?: string;
  iconClassName?: string;
};

/** Used across the plugins module for every outside link: open (built-in browser by default) plus copy. */
export default function PluginLink({ href, children, className, iconClassName = 'h-3.5 w-3.5' }: PluginLinkProps) {
  const { t } = useTranslation('settings');
  const openInBrowser = useContext(PluginLinkContext);
  // Copy feedback on the button itself; "failed" keeps the address visible in its tooltip.
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // The address is in the name so several copy buttons on one page stay distinguishable.
  const copyLabel = copied === 'copied' ? t('extensions.linkCopiedShort') : copied === 'failed' ? t('extensions.copyLinkBlocked', { url: href }) : t('extensions.copyLinkTo', { url: href });
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      {openInBrowser ? (
        <button type="button" className={className} title={t('extensions.opensInBuiltInBrowser', { url: href })} onClick={() => openInBrowser(href)}>
          {children}<Globe className={iconClassName} aria-hidden="true" />
        </button>
      ) : (
        <a className={className} href={href} target="_blank" rel="noopener noreferrer">
          {children}<ExternalLink className={iconClassName} aria-hidden="true" />
        </a>
      )}
      <button
        type="button"
        className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={async () => setCopied(await copyTextToClipboard(href) ? 'copied' : 'failed')}
      >
        {copied === 'copied' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      {copied && <span role="status" className="sr-only">{copyLabel}</span>}
    </span>
  );
}
