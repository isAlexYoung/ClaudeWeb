import { useCallback, useEffect, useState } from 'react';
import type { TextQuote } from '@/shared/types';

function read(scope: string): TextQuote[] {
  try {
    const saved = JSON.parse(localStorage.getItem(`claudeweb-quotes:${scope}`) || '[]');
    return Array.isArray(saved) ? saved.filter(q => q && typeof q.id === 'string' && typeof q.text === 'string') : [];
  } catch { return []; }
}
/** Used by ChatInterface to retain selection drafts independently for each main conversation. */
export function useTextQuotes(scope: string) {
  // Scope travels with the draft so a session-switch commit cannot save it under another conversation.
  const [draft, setDraft] = useState(() => ({ scope, quotes: read(scope) }));
  const quotes = draft.scope === scope ? draft.quotes : read(scope);
  useEffect(() => { if (draft.scope !== scope) setDraft({ scope, quotes: read(scope) }); }, [draft.scope, scope]);
  const update = useCallback((change: (current: TextQuote[]) => TextQuote[]) => {
    setDraft(previous => {
      const next = change(previous.scope === scope ? previous.quotes : read(scope));
      try { localStorage.setItem(`claudeweb-quotes:${scope}`, JSON.stringify(next)); } catch { /* Keep the draft in memory when browser storage is unavailable. */ }
      return { scope, quotes: next };
    });
  }, [scope]);
  return { quotes, addQuote: (quote: TextQuote) => update(current => [...current, quote]),
    replaceQuotes: useCallback((next: TextQuote[]) => update(() => next), [update]),
    removeQuotes: useCallback((ids: string[]) => update(current => current.filter(q => !ids.includes(q.id))), [update]) };
}
