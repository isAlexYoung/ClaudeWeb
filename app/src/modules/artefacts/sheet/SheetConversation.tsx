import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';

import { api } from '@/shared/api';
import type { NormalizedMessage } from '@/shared/types';
import { toConversationEntries } from '@/modules/artefacts/sheet/conversationEntries';

type SheetConversationProps = {
  /** The spreadsheet's conversation; null before the first request to Claude. */
  sessionId: string | null;
  /** Claude is working: the drawer refreshes until it stops. */
  running: boolean;
  /** Places a prompt suggestion into the editor's composer without sending it. */
  onSelectSuggestion: (prompt: string) => void;
  onOpenInChat: (sessionId: string) => void;
};

const REFRESH_MS = 2000;
const MESSAGE_LIMIT = 80;
const SUGGESTION_KEYS = ['tracker', 'budget', 'pipeline'] as const;

/** Hand-drawn green grid sketch shown in the empty conversation panel. */
function EmptySheetSketch() {
  return (
    <svg className="sheet-conversation-sketch" width="96" height="74" viewBox="0 0 96 74" fill="none" aria-hidden="true">
      {/* Soft pastel crayon strokes behind the grid lines */}
      <path d="M12 20c24-2 50-1 72 0M11 36c25-1 51 1 74 0M13 52c23 1 48-1 70 0" stroke="var(--kind-bg)" strokeWidth="8" strokeLinecap="round" opacity="0.95" />
      <path d="M24 10c1 18-1 36 0 54M48 9c-1 19 1 37 0 56M72 10c1 18 0 36-1 54" stroke="var(--kind-bg)" strokeWidth="8" strokeLinecap="round" opacity="0.95" />
      {/* Sketchy darker grid lines */}
      <path d="M10 19.5c25-1.5 52-.8 76 .5M9 36.2c26-.6 53 .8 78-.2M11 52.8c24 .9 50-.7 74 .2" stroke="var(--kind-fg)" strokeWidth="2.4" strokeLinecap="round" opacity="0.72" />
      <path d="M23.5 9c.8 19-.6 37 .3 56M48.2 8c-.7 19 .6 38-.2 58M72.4 9.5c.6 18-.5 36 .2 55" stroke="var(--kind-fg)" strokeWidth="2.4" strokeLinecap="round" opacity="0.72" />
      {/* Second subtle offset pass for crayon texture */}
      <path d="M13 21.2c23-.4 48 .6 70-.4M12 37.8c24 .6 50-.5 73 .4M14 54.1c22-.5 46 .5 68-.3" stroke="var(--kind-fg)" strokeWidth="1.2" strokeLinecap="round" opacity="0.32" />
    </svg>
  );
}

/** The latest page of a conversation, or null when it could not be read. */
async function fetchConversation(sessionId: string): Promise<NormalizedMessage[] | null> {
  try {
    const response = await api.providers.sessionMessages(sessionId, { limit: MESSAGE_LIMIT, offset: 0 });
    if (!response.ok) return null;
    const body = await response.json() as { data?: { messages?: NormalizedMessage[] } };
    return Array.isArray(body.data?.messages) ? body.data.messages : [];
  } catch {
    return null;
  }
}

/**
 * Rendered by SpreadsheetEditor when the conversation drawer is open: shows an
 * illustrated prompt picker before any turns exist, or the conversation's
 * messages with a link to continue in full chat once turns exist.
 */
export default function SheetConversation({ sessionId, running, onSelectSuggestion, onOpenInChat }: SheetConversationProps) {
  const { t } = useTranslation('sidebar');
  // The latest page of the conversation; null until it has been read once.
  const [messages, setMessages] = useState<NormalizedMessage[] | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const next = await fetchConversation(sessionId);
    // A failed read keeps what the drawer last showed.
    if (next) setMessages(next);
  }, [sessionId]);

  // Read when opened, after every run ends, and repeatedly while one is going.
  useEffect(() => {
    queueMicrotask(() => void load());
    if (!running) return undefined;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, running]);

  const entries = useMemo(() => toConversationEntries(messages ?? []), [messages]);
  const isEmpty = !running && (!sessionId || (messages !== null && entries.length === 0));

  return (
    <aside className="sheet-conversation artefact-kind-sheet" aria-label={t('artefacts.editor.conversation.title')}>
      <div className="sheet-conversation-head">
        <h2>{t('artefacts.editor.conversation.title')}</h2>
      </div>
      <div className={`sheet-conversation-body ${isEmpty ? 'is-empty' : ''}`}>
        {isEmpty ? (
          <div className="sheet-conversation-empty-state">
            <EmptySheetSketch />
            <h3 className="sheet-conversation-empty-title">{t('artefacts.editor.conversation.emptyTitle')}</h3>
            <div className="sheet-conversation-suggestions">
              {SUGGESTION_KEYS.map((key) => {
                const prompt = t(`artefacts.editor.conversation.suggestions.${key}`);
                return (
                  <button
                    key={key}
                    type="button"
                    className="sheet-conversation-suggestion"
                    onClick={() => onSelectSuggestion(prompt)}
                  >
                    {prompt}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {entries.map((entry) => (entry.kind === 'tools' ? (
              <p key={entry.id} className="sheet-conversation-tools">{t('artefacts.editor.conversation.tools', { count: entry.count })}</p>
            ) : (
              <div key={entry.id} className={`sheet-conversation-message ${entry.role}`}>
                <span className="sheet-conversation-role">
                  {entry.role === 'user' ? t('artefacts.editor.conversation.you') : 'Claude'}
                </span>
                <p>{entry.text}</p>
              </div>
            )))}
            {running && <p className="sheet-conversation-tools" role="status">{t('artefacts.editor.working')}</p>}
          </>
        )}
      </div>
      {sessionId && entries.length > 0 && (
        <button type="button" className="sheet-conversation-open" onClick={() => onOpenInChat(sessionId)}>
          {t('artefacts.editor.conversation.openInChat')}
          <ArrowUpRight size={15} />
        </button>
      )}
    </aside>
  );
}
