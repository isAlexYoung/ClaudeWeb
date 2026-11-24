import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';

import { api } from '@/shared/api';
import type { NormalizedMessage } from '@/shared/types';
import { kindTextKey } from '@/modules/artefacts/editor/kindText';
import { toConversationEntries } from '@/modules/artefacts/sheet/conversationEntries';
import type { EditableArtefactKind } from '@/modules/artefacts/useArtefacts';

type SheetConversationProps = {
  /** Which editor the drawer belongs to; picks the empty state's sketch and suggestions. */
  kind?: EditableArtefactKind;
  /** The spreadsheet's conversation; null before the first request to Claude. */
  sessionId: string | null;
  /** Claude is working: the drawer refreshes until it stops. */
  running: boolean;
  /** The last run's error, shown so a failed turn never looks like nothing happened. */
  error?: string | null;
  /** Places a prompt suggestion into the editor's composer without sending it. */
  onSelectSuggestion: (prompt: string) => void;
  onOpenInChat: (sessionId: string) => void;
};

const REFRESH_MS = 2000;
const MESSAGE_LIMIT = 80;
const SUGGESTION_KEYS: Record<EditableArtefactKind, readonly string[]> = {
  sheet: ['tracker', 'budget', 'pipeline'],
  doc: ['brief', 'notes', 'plan'],
  whiteboard: ['flow', 'architecture', 'mindmap'],
};

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

/** Hand-drawn page with a heading and text lines, shown in an empty document conversation. */
function EmptyDocSketch() {
  return (
    <svg className="sheet-conversation-sketch" width="96" height="74" viewBox="0 0 96 74" fill="none" aria-hidden="true">
      <path d="M24 6c16-.8 32-.6 48 .3 1 20 .8 41-.2 62-16 .7-32 .5-48-.4-.8-20.6-.7-41.2.2-61.9Z" fill="var(--kind-soft)" />
      <path d="M23.5 6.2c16.4-.9 32.6-.5 48.8.2.8 20.4.7 41.2-.4 61.8-16.2.6-32.4.4-48.6-.5-.7-20.5-.6-41 .2-61.5Z" stroke="var(--kind-fg)" strokeWidth="2.2" strokeLinejoin="round" opacity="0.72" />
      <path d="M32 18c9-.6 18-.4 27 .2" stroke="var(--kind-bg)" strokeWidth="7" strokeLinecap="round" />
      <path d="M32 17.5c9-.5 18-.3 27 .3" stroke="var(--kind-fg)" strokeWidth="2.6" strokeLinecap="round" opacity="0.8" />
      <path d="M32 31c11-.4 22 .3 32-.1M32 40.5c10 .3 21-.4 32 .2M32 50c8-.2 16 .4 22 0" stroke="var(--kind-fg)" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

/** Hand-drawn boxes and an arrow, shown in an empty whiteboard conversation. */
function EmptyWhiteboardSketch() {
  return (
    <svg className="sheet-conversation-sketch" width="96" height="74" viewBox="0 0 96 74" fill="none" aria-hidden="true">
      <path d="M6 10c10-.8 20-.5 30 .3.7 7.6.5 15-.3 22.6-10 .6-20 .4-29.8-.4-.6-7.5-.6-15 .1-22.5Z" fill="var(--kind-bg)" stroke="var(--kind-fg)" strokeWidth="2.2" strokeLinejoin="round" opacity="0.85" />
      <ellipse cx="70" cy="20" rx="18" ry="11.5" fill="var(--kind-soft)" stroke="var(--kind-fg)" strokeWidth="2.2" opacity="0.85" />
      <path d="M52 50.5c11-.8 23-.5 34 .3.6 6.6.4 13-.4 19.5-11.2.6-22.4.4-33.4-.4-.6-6.4-.7-12.9-.2-19.4Z" fill="var(--kind-soft)" stroke="var(--kind-fg)" strokeWidth="2.2" strokeLinejoin="round" opacity="0.85" />
      <path d="M37 21.5c4.5-.5 9-.4 13.5-.2M47 17.6l4.4 3.6-4.6 3.8" stroke="var(--kind-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <path d="M70 32.5c-.4 5.5-.1 11 .2 16M66.2 45.4l4 4.2 3.8-4.4" stroke="var(--kind-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <path d="M10 50c6-3 10 3 15 0s9-3 14 .5" stroke="var(--kind-fg)" strokeWidth="1.6" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

const SKETCHES: Record<EditableArtefactKind, () => ReactElement> = {
  sheet: EmptySheetSketch,
  doc: EmptyDocSketch,
  whiteboard: EmptyWhiteboardSketch,
};

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

type SheetConversationEmptyStateProps = {
  /** Which editor the empty state belongs to: picks the sketch, heading and suggestions. */
  kind?: EditableArtefactKind;
  /** Places a prompt suggestion into the editor's composer without sending it. */
  onSelectSuggestion: (prompt: string) => void;
  /** Optional error notice shown above the illustration when the last run failed. */
  error?: string | null;
};

/** Illustrated prompt picker shown in an empty artefact conversation (spreadsheet, document or whiteboard). */
export function SheetConversationEmptyState({ kind = 'sheet', onSelectSuggestion, error }: SheetConversationEmptyStateProps) {
  const { t } = useTranslation('sidebar');
  const Sketch = SKETCHES[kind];
  return (
    <div className={`sheet-conversation-empty-shell artefact-kind-${kind}`}>
      <div className="sheet-conversation-empty-state">
        {error && <p role="alert" className="sheet-conversation-error">{t('artefacts.editor.failed', { error })}</p>}
        <Sketch />
        <h3 className="sheet-conversation-empty-title">{t(kindTextKey(kind, 'conversation.emptyTitle'))}</h3>
        <div className="sheet-conversation-suggestions">
          {SUGGESTION_KEYS[kind].map((key) => {
            const prompt = t(kindTextKey(kind, `conversation.suggestions.${key}`));
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
    </div>
  );
}

/**
 * Rendered by SpreadsheetEditor when standalone (without an external split ChatInterface):
 * shows an illustrated prompt picker before any turns exist, or the conversation's
 * messages with a link to continue in full chat once turns exist.
 */
export default function SheetConversation({ kind = 'sheet', sessionId, running, error, onSelectSuggestion, onOpenInChat }: SheetConversationProps) {
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
    <aside className={`sheet-conversation artefact-kind-${kind}`} aria-label={t('artefacts.editor.conversation.title')}>
      <div className="sheet-conversation-head">
        <h2>{t('artefacts.editor.conversation.title')}</h2>
      </div>
      <div className={`sheet-conversation-body ${isEmpty ? 'is-empty' : ''}`}>
        {isEmpty ? (
          <SheetConversationEmptyState kind={kind} onSelectSuggestion={onSelectSuggestion} error={error} />
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
            {running && <p className="sheet-conversation-tools" role="status">{t(kindTextKey(kind, 'working'))}</p>}
            {!running && error && <p role="alert" className="sheet-conversation-error">{t('artefacts.editor.failed', { error })}</p>}
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
