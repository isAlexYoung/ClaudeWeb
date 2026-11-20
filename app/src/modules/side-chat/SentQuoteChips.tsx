import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { TextQuote } from '@/shared/types';
import '@/modules/side-chat/side-chat.css';

/** Used by chat message rows to show sent excerpts without displaying the model's transport envelope. */
export function SentQuoteChips({ quotes, sessionId, isExporting = false }: { quotes: TextQuote[]; sessionId: string | null; isExporting?: boolean }) {
  const { t } = useTranslation('common');
  const tooltipId = useId();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  // A portal keeps the hovered excerpt outside lazy-row clipping and within the viewport.
  const [preview, setPreview] = useState<{ quote: TextQuote; left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const keepOpen = () => clearTimeout(closeTimer.current);
  const closeSoon = () => { keepOpen(); closeTimer.current = setTimeout(() => setPreview(null), 120); };
  useEffect(() => {
    const close = (event: Event) => {
      if (!(event.target instanceof Node) || !tooltipRef.current?.contains(event.target)) setPreview(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { clearTimeout(closeTimer.current); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, []);
  const show = (quote: TextQuote, button: HTMLButtonElement) => {
    keepOpen();
    const rect = button.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 32);
    const above = rect.top > window.innerHeight / 2;
    setPreview({ quote, width, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      ...(above ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      maxHeight: Math.max(40, Math.min(220, above ? rect.top - 14 : window.innerHeight - rect.bottom - 14)) });
  };
  return <>
    <div className="sent-quote-chips" aria-label={t('sideChat.quotes')}>
      {quotes.map((quote, index) => <button type="button" key={quote.id} className="sent-quote-chip"
        title={t('sideChat.jump')} disabled={isExporting || !sessionId}
        aria-describedby={preview?.quote === quote ? tooltipId : undefined}
        onMouseEnter={event => show(quote, event.currentTarget)} onMouseLeave={closeSoon}
        onFocus={event => show(quote, event.currentTarget)} onBlur={closeSoon}
        onKeyDown={event => { if (event.key === 'Escape') setPreview(null); }}
        onClick={() => { setPreview(null); window.dispatchEvent(new CustomEvent('claudeweb:quote-jump', { detail: { parentSessionId: sessionId, source: quote } })); }}>
        {t('sideChat.quoteNumber', { number: t(`sideChat.ordinals.${index}`, { defaultValue: String(index + 1) }) })}
      </button>)}
    </div>
    {preview && !isExporting && createPortal(<div ref={tooltipRef} id={tooltipId} role="tooltip" className="sent-quote-preview" onMouseEnter={keepOpen} onMouseLeave={closeSoon}
      style={{ left: preview.left, top: preview.top, bottom: preview.bottom, width: preview.width, maxHeight: preview.maxHeight }}>
      {preview.quote.text}
    </div>, document.body)}
  </>;
}
