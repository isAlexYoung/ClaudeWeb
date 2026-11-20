import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Minus, X, Grip, ArrowUp, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SideChat } from '@/shared/types';
import { DeleteSideChatDialog } from '@/modules/side-chat/DeleteSideChatDialog';

type Props = {
  chat: SideChat; modelLabel: string; number: number; active: boolean;
  onUpdate: (patch: Partial<SideChat>) => Promise<unknown>;
  onSend: (content: string) => Promise<unknown>; onStop: () => Promise<unknown>; onDelete: () => Promise<unknown>;
};
let topLayer = 130;
function clamp(position: SideChat['position']) {
  const viewport = window.visualViewport;
  const left = (viewport?.offsetLeft || 0) + 8, top = (viewport?.offsetTop || 0) + 8;
  const availableWidth = (viewport?.width || window.innerWidth) - 16;
  const availableHeight = (viewport?.height || window.innerHeight) - 16;
  const width = Math.min(position.width, Math.max(160, availableWidth));
  const height = Math.min(position.height, Math.max(160, availableHeight));
  return { width, height, x: Math.max(left, Math.min(position.x, left + availableWidth - width)), y: Math.max(top, Math.min(position.y, top + availableHeight - height)) };
}

/** Used by SelectionTools to provide a non-modal, screen-fixed conversation beside selected text. */
export function SideChatWindow({ chat, modelLabel, number, active, onUpdate, onSend, onStop, onDelete }: Props) {
  const { t } = useTranslation('common');
  // Live pointer geometry stays local until the gesture ends; streaming updates cannot move the window.
  const [position, setPosition] = useState(() => clamp(chat.position));
  const positionRef = useRef(position);
  // The input is immediate while its independent draft is saved with a short debounce.
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem(`side-chat-draft:${chat.id}`) ?? chat.draft; } catch { return chat.draft; } });
  const dirty = useRef(draft !== chat.draft);
  // Only an acknowledgement for the latest edit may release local draft protection.
  const draftRevision = useRef(0);
  const saving = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  // Bring a touched panel in front of other side panels without blocking the main transcript.
  const [layer, setLayer] = useState(() => ++topLayer);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const gesture = useRef<{ x: number; y: number; position: SideChat['position']; resize: boolean } | null>(null);
  // Actions change on parent renders; effects intentionally use the latest functions without restarting timers.
  const actions = useRef({ onUpdate, onSend });
  actions.current = { onUpdate, onSend };
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || !active || chat.minimized) return;
    const resize = () => {
      // Reset first so deleting text also shrinks the composer; CSS caps long drafts.
      input.style.height = 'auto';
      input.style.height = `${Math.max(38, input.scrollHeight)}px`;
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    if (input.parentElement) observer?.observe(input.parentElement);
    return () => observer?.disconnect();
  }, [draft, active, chat.minimized, position.width, position.height]);
  useEffect(() => {
    if (!dirty.current && !saving.current) setDraft(chat.draft);
  }, [chat.draft]);
  useEffect(() => {
    const resize = () => { const next = clamp(positionRef.current); positionRef.current = next; setPosition(next); };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => { window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); };
  }, []);
  useEffect(() => {
    if (!dirty.current) return;
    const revision = draftRevision.current;
    const timer = setTimeout(() => {
      if (saving.current) return;
      void actions.current.onUpdate({ draft }).then(() => {
        if (draftRevision.current !== revision) return;
        dirty.current = false;
        try { if (localStorage.getItem(`side-chat-draft:${chat.id}`) === draft) localStorage.removeItem(`side-chat-draft:${chat.id}`); } catch { /* Storage may be unavailable. */ }
      }).catch(() => {
        if (draftRevision.current === revision) { dirty.current = true; setError(t('sideChat.saveFailed')); }
      });
    }, 450);
    return () => clearTimeout(timer);
  }, [draft, t]);
  useEffect(() => {
    if (active && !chat.minimized && follow.current && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [chat.messages, active, chat.minimized]);
  const startGesture = (event: ReactPointerEvent<HTMLElement>, resize: boolean) => {
    if ((event.target as Element).closest('button') || event.button !== 0) return;
    event.preventDefault();
    gesture.current = { x: event.clientX, y: event.clientY, position: positionRef.current, resize };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const start = gesture.current; if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const next = clamp(start.resize ? { ...start.position, width: Math.max(260, start.position.width + dx), height: Math.max(220, start.position.height + dy) }
      : { ...start.position, x: start.position.x + dx, y: start.position.y + dy });
    positionRef.current = next; setPosition(next);
  };
  const finishGesture = () => {
    if (!gesture.current) return;
    gesture.current = null;
    void onUpdate({ position: positionRef.current }).catch(() => setError(t('sideChat.saveFailed')));
  };
  const send = async () => {
    if (!draft.trim() || submitting || saving.current || chat.status === 'running') return;
    saving.current = true; setSubmitting(true); setError('');
    const content = draft;
    // Keep typed text on a failed request; the server clears its draft only after accepting the question.
    try { await actions.current.onSend(content); dirty.current = false; setDraft(''); try { localStorage.removeItem(`side-chat-draft:${chat.id}`); } catch { /* Browser storage may be disabled. */ } follow.current = true; }
    catch { setError(t('sideChat.sendFailed')); }
    finally { saving.current = false; setSubmitting(false); }
  };
  return createPortal(<>
    <section data-side-chat-surface="true" role="dialog" aria-modal="false" aria-label={`${t('sideChat.title')} ${number}`} className="side-chat-window"
      style={{ left: position.x, top: position.y, width: position.width, height: position.height, zIndex: layer, display: active && !chat.minimized ? undefined : 'none' }}
      onPointerDown={() => setLayer(++topLayer)} onKeyDown={event => event.stopPropagation()}>
      <header onPointerDown={event => startGesture(event, false)} onPointerMove={moveGesture} onPointerUp={finishGesture} onPointerCancel={finishGesture}>
        <strong>{t('sideChat.title')} {number}</strong><small>{modelLabel}</small>
        <button type="button" title={t('sideChat.minimize')} aria-label={t('sideChat.minimize')} onClick={() => void onUpdate({ minimized: true }).catch(() => setError(t('sideChat.saveFailed')))}><Minus size={17} /></button>
        <button type="button" title={t('sideChat.delete')} aria-label={t('sideChat.delete')} onClick={() => setConfirmDelete(true)}><X size={17} /></button>
      </header>
      <details className="side-chat-origin"><summary title={chat.source.text}>{chat.source.text}</summary><small>{t(chat.source.kind === 'thinking' ? 'sideChat.fromThinking' : chat.source.role === 'assistant' ? 'sideChat.fromAssistant' : 'sideChat.fromUser')}</small><p>{chat.source.text}</p></details>
      <div ref={bodyRef} className="side-chat-messages" onScroll={() => { const el = bodyRef.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 45; }}>
        {!chat.messages.length && <p className="side-chat-hint">{t('sideChat.startHint')}</p>}
        {chat.messages.map(message => <div key={message.id} className={`side-chat-message ${message.role}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>)}
        {chat.status === 'running' && <p role="status" className="side-chat-hint">{t('sideChat.generating')}</p>}
        {(chat.error || error) && <p role="alert" className="side-chat-error">{error || (chat.error === 'SIDECAR_RESTARTED' ? t('sideChat.restarted') : chat.error)}</p>}
      </div>
      <form onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea ref={inputRef} rows={1} aria-label={t('sideChat.input')} placeholder={t('sideChat.input')} value={draft} onChange={event => { draftRevision.current++; dirty.current = true; setDraft(event.target.value); try { localStorage.setItem(`side-chat-draft:${chat.id}`, event.target.value); } catch { /* The server draft remains available. */ } }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
          }} />
        {chat.status === 'running' ? <button type="button" aria-label={t('sideChat.stop')} onClick={() => void onStop().catch(() => setError(t('sideChat.sendFailed')))}><Square size={15} /></button>
          : <button type="submit" disabled={!draft.trim() || submitting} aria-label={t('sideChat.send')}><ArrowUp size={17} /></button>}
      </form>
      <div className="side-chat-resizer" role="separator" aria-label={t('sideChat.resize')} tabIndex={0}
        onPointerDown={event => startGesture(event, true)} onPointerMove={moveGesture} onPointerUp={finishGesture} onPointerCancel={finishGesture}
        onKeyDown={event => {
          const sizes: Record<string, [number, number]> = { ArrowRight: [20, 0], ArrowLeft: [-20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
          if (!sizes[event.key]) return; event.preventDefault();
          const [w, h] = sizes[event.key]; const next = clamp({ ...position, width: Math.max(260, position.width + w), height: Math.max(220, position.height + h) });
          positionRef.current = next; setPosition(next); void onUpdate({ position: next }).catch(() => setError(t('sideChat.saveFailed')));
        }}><Grip size={12} /></div>
    </section>
    {confirmDelete && active && <DeleteSideChatDialog onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); void onDelete().catch(() => setError(t('sideChat.deleteFailed'))); }} />}
  </>, document.body);
}
