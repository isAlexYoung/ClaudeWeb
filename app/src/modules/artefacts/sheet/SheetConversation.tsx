import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, X } from 'lucide-react';

import { api } from '@/shared/api';
import type { NormalizedMessage } from '@/shared/types';
import { toConversationEntries } from '@/modules/artefacts/sheet/conversationEntries';

type SheetConversationProps = {
  /** The spreadsheet's conversation; null before the first request to Claude. */
  sessionId: string | null;
  /** Claude is working: the drawer refreshes until it stops. */
  running: boolean;
  onClose: () => void;
  onOpenInChat: (sessionId: string) => void;
};

const REFRESH_MS = 2000;
const MESSAGE_LIMIT = 80;

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
 * Rendered by SpreadsheetEditor when "Show conversation" is on: the
 * spreadsheet's conversation with Claude, read-only, and a link to continue it
 * in the full chat.
 */
export default function SheetConversation({ sessionId, running, onClose, onOpenInChat }: SheetConversationProps) {
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

  return (
    <aside className="sheet-conversation" aria-label={t('artefacts.editor.conversation.title')}>
      <div className="sheet-conversation-head">
        <h2>{t('artefacts.editor.conversation.title')}</h2>
        <button type="button" className="artefact-icon-button" aria-label={t('artefacts.editor.hideConversation')} title={t('artefacts.editor.hideConversation')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="sheet-conversation-body">
        {(!sessionId || (messages !== null && entries.length === 0)) && (
          <p className="sheet-conversation-empty">{t('artefacts.editor.conversation.empty')}</p>
        )}
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
      </div>
      {sessionId && (
        <button type="button" className="sheet-conversation-open" onClick={() => onOpenInChat(sessionId)}>
          {t('artefacts.editor.conversation.openInChat')}
          <ArrowUpRight size={15} />
        </button>
      )}
    </aside>
  );
}
