import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { TextQuote } from '@/shared/types';

/** Used by chat's composer host to show removable, immutable excerpts above the input. */
export function QuoteDrafts({ quotes, onRemove }: { quotes: TextQuote[]; onRemove: (ids: string[]) => void }) {
  const { t } = useTranslation('common');
  if (!quotes.length) return null;
  return <div className="quote-drafts" aria-label={t('sideChat.quotes')}>
    {quotes.map((quote, index) => <div key={quote.id} className="quote-chip" tabIndex={0}>
      <span>{t('sideChat.quoteNumber', { number: t(`sideChat.ordinals.${index}`, { defaultValue: String(index + 1) }) })}</span>
      <button type="button" aria-label={t('sideChat.removeQuote')} title={t('sideChat.removeQuote')} onClick={() => onRemove([quote.id])}><X size={13} /></button>
      <div className="quote-chip-preview" role="tooltip"><small>{t(quote.kind === 'thinking' ? 'sideChat.fromThinking' : quote.role === 'assistant' ? 'sideChat.fromAssistant' : 'sideChat.fromUser')}</small><p>{quote.text}</p></div>
    </div>)}
  </div>;
}
