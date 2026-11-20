import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ProjectMemoryEditor } from '@/modules/project-memory';
import type { ChatMessage, ProviderModelOption, TextQuote } from '@/shared/types';
import { catalogModelName } from '@/shared/utils';
import { useSideChats } from '@/modules/side-chat/hooks/useSideChats';
import { SideChatWindow } from '@/modules/side-chat/SideChatWindow';
import { captureTextQuote, locateQuoteRange } from '@/modules/side-chat/utils/selectionAnchor';
import '@/modules/side-chat/side-chat.css';

type Props = {
  parentSessionId: string | null; active: boolean; containerRef: RefObject<HTMLDivElement>;
  messages: ChatMessage[]; modelOptions: ProviderModelOption[]; model: string; effort: string; provider: string;
  captureContext: () => Promise<string>;
  onQuote: (quote: TextQuote) => void; onReveal: (source: TextQuote) => Promise<boolean>;
  memoryProject?: { id: string; name: string } | null;
};
/** Used by ChatInterface for selection actions, original-text markers and independent floating windows. */
export function SelectionTools(props: Props) {
  const { t } = useTranslation('common');
  const collection = useSideChats(props.parentSessionId);
  // Freeze selected text and its initial toolbar position before the live transcript can change.
  const [selection, setSelection] = useState<ReturnType<typeof captureTextQuote>>(null);
  // Marker rectangles are derived from mounted DOM ranges, separate from fixed window geometry.
  const [markers, setMarkers] = useState<Array<{ id: string; rect: { x: number; y: number; width: number } }>>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  // Freeze the destination and source while a memory is edited; streaming text cannot alter either.
  const [memory, setMemory] = useState<{ source: TextQuote; anchor: { x: number; y: number } } | null>(null);
  // A successful write is acknowledged independently of side-chat API errors.
  const [memorySaved, setMemorySaved] = useState(false);
  const creatingRef = useRef(false);
  const latest = useRef({ props, collection }); latest.current = { props, collection };
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setSelection(null); setError(''); }, [props.parentSessionId, props.active]);
  useEffect(() => { setMemory(null); setMemorySaved(false); }, [props.parentSessionId, props.active, props.memoryProject?.id]);
  useEffect(() => { if (!memorySaved) return; const timer = setTimeout(() => setMemorySaved(false), 5000); return () => clearTimeout(timer); }, [memorySaved]);
  useEffect(() => {
    if (!props.active) return;
    let frame = 0;
    const changed = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = props.containerRef.current; const selected = window.getSelection();
        setSelection(root && selected ? captureTextQuote(root, selected) : null);
      });
    };
    const outside = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setSelection(null);
    };
    document.addEventListener('selectionchange', changed);
    document.addEventListener('pointerup', changed);
    document.addEventListener('pointerdown', outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('selectionchange', changed); document.removeEventListener('pointerup', changed); document.removeEventListener('pointerdown', outside); };
  }, [props.active, props.containerRef]);
  useEffect(() => {
    const root = props.containerRef.current;
    if (!root || !props.active) { setMarkers([]); return; }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = root.getBoundingClientRect();
        const next: typeof markers = [];
        for (const chat of latest.current.collection.chats) {
          const range = locateQuoteRange(root, chat.source);
          if (!range || typeof range.getClientRects !== 'function') continue;
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width > 0 && rect.height > 0) {
              const left = Math.max(rect.left, viewport.left);
              next.push({ id: chat.id, rect: { x: left - viewport.left + root.scrollLeft, y: rect.bottom - viewport.top + root.scrollTop, width: Math.max(0, Math.min(rect.right, viewport.right) - left) } });
            }
          }
          const row = range.startContainer.parentElement?.closest('[data-selection-message]');
          if (row) resize?.observe(row);
        }
        setMarkers(next);
      });
    };
    const mutation = new MutationObserver(measure); mutation.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-state', 'style'] });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure); resize?.observe(root);
    window.addEventListener('resize', measure); measure();
    return () => { cancelAnimationFrame(frame); mutation.disconnect(); resize?.disconnect(); window.removeEventListener('resize', measure); };
  }, [props.active, props.containerRef, collection.chats]);
  useEffect(() => {
    if (!props.active) return;
    let cancelled = false;
    const jump = async (event: Event) => {
      const detail = (event as CustomEvent<{ parentSessionId: string; id?: string; source?: TextQuote }>).detail;
      const current = latest.current;
      if (detail.parentSessionId !== current.props.parentSessionId) return;
      const source = event.type === 'claudeweb:quote-jump' ? detail.source : current.collection.chats.find(c => c.id === detail.id)?.source;
      if (!source) return;
      if (!await current.props.onReveal(source)) { if (!cancelled) setError(t('sideChat.quoteOriginMissing')); return; }
      // Lazy rows and a collapsed thinking disclosure may need a few commits before their text is mounted.
      const attempt = (remaining: number) => requestAnimationFrame(() => {
        if (cancelled) return;
        const root = current.props.containerRef.current; if (!root) return;
        let range = locateQuoteRange(root, source);
        if (!range && source.kind === 'thinking') {
          const row = Array.from(root.querySelectorAll<HTMLElement>('[data-source-message-key], [data-source-message-keys]')).find(el => el.dataset.sourceMessageKey === source.messageKey || JSON.parse(el.dataset.sourceMessageKeys || '[]').includes(source.messageKey));
          row?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click();
          range = locateQuoteRange(root, source);
        }
        if (!range) { if (remaining) attempt(remaining - 1); else setError(t('sideChat.quoteOriginMissing')); return; }
        const rect = range.getBoundingClientRect(); const bounds = root.getBoundingClientRect();
        root.scrollTop += rect.top - bounds.top - Math.min(100, root.clientHeight / 4);
        setError('');
      });
      attempt(24);
    };
    window.addEventListener('claudeweb:sidechat-jump', jump);
    window.addEventListener('claudeweb:quote-jump', jump);
    return () => { cancelled = true; window.removeEventListener('claudeweb:sidechat-jump', jump); window.removeEventListener('claudeweb:quote-jump', jump); };
  }, [props.active, props.parentSessionId, t]);
  useEffect(() => {
    if (!props.active || !props.parentSessionId) return;
    const key = `claudeweb:memory-jump:${props.parentSessionId}`;
    const timer = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key); if (!raw) return;
        const pending = JSON.parse(raw); sessionStorage.removeItem(key);
        if (pending.expiresAt > Date.now() && typeof pending.source?.text === 'string') window.dispatchEvent(new CustomEvent('claudeweb:quote-jump', { detail: pending }));
      } catch { sessionStorage.removeItem(key); }
    }, props.messages.length ? 0 : 2000);
    return () => clearTimeout(timer);
  }, [props.active, props.parentSessionId, props.messages.length]);
  const create = async () => {
    if (!selection || creatingRef.current || !props.parentSessionId) return;
    creatingRef.current = true; setCreating(true); setError('');
    const captured = selection;
    const parent = props.parentSessionId;
    // Serialize now: subsequent main-chat tokens must not mutate the side chat's starting context.
    const capturedContext = props.captureContext();
    try {
      const context = await capturedContext;
      const chat = await collection.create(captured.source, context, props.model, props.effort);
      if (chat) await collection.update(chat.id, { position: { x: Math.max(8, Math.min(captured.rect.right + 12, window.innerWidth - 448)), y: Math.max(8, Math.min(captured.rect.bottom + 12, window.innerHeight - 468)), width: 440, height: 460 } });
      if (latest.current.props.parentSessionId === parent) setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) { setError(e instanceof Error && e.message === 'SIDE_CHAT_PROVIDER_UNSUPPORTED' ? t('sideChat.unsupported') : t('sideChat.createFailed')); }
    finally { creatingRef.current = false; setCreating(false); }
  };
  return <>
    {props.active && selection && createPortal(<div data-side-chat-surface="true" ref={toolbarRef} className="text-selection-actions" role="toolbar" aria-label={t('sideChat.selectionActions')}
      style={{ left: Math.max(8, Math.min(selection.rect.left, window.innerWidth - 330)), top: Math.max(8, Math.min(selection.rect.bottom + 7, window.innerHeight - 48)), maxWidth: 'calc(100vw - 16px)' }}
      onPointerDown={event => event.preventDefault()}>
      <button type="button" onClick={() => { props.onQuote(selection.source); setSelection(null); window.getSelection()?.removeAllRanges(); }}>{t('sideChat.quote')}</button>
      <button type="button" disabled={creating || !props.parentSessionId} onClick={() => void create()}>{t('sideChat.title')}</button>
      <button type="button" disabled={!props.memoryProject || !props.parentSessionId} title={!props.memoryProject ? t('projectMemory.chooseProject') : undefined} onClick={() => {
        setMemory({ source: selection.source, anchor: { x: selection.rect.left, y: selection.rect.bottom + 46 } }); setSelection(null); window.getSelection()?.removeAllRanges();
      }}>{t('projectMemory.write')}</button>
    </div>, document.body)}
    {props.active && memory && props.memoryProject && props.parentSessionId && <ProjectMemoryEditor key={props.memoryProject.id} projectId={props.memoryProject.id} projectName={props.memoryProject.name} sessionId={props.parentSessionId}
      source={memory.source} anchor={memory.anchor} onClose={() => setMemory(null)} onSaved={() => setMemorySaved(true)} />}
    {memorySaved && <div role="status" className="project-memory-toast">{t('projectMemory.saved')}</div>}
    {props.active && props.containerRef.current && markers.map((marker, index) => createPortal(<button key={`${marker.id}:${index}`} className="side-chat-source-mark" title={t('sideChat.expand')} aria-label={t('sideChat.expand')}
      style={{ left: marker.rect.x, top: marker.rect.y - 1, width: marker.rect.width }} onClick={() => void collection.update(marker.id, { minimized: false }).catch(() => setError(t('sideChat.saveFailed')))} />, props.containerRef.current!))}
    {collection.chats.map((chat, index) => <SideChatWindow key={chat.id} chat={chat} number={index + 1} active={props.active}
      modelLabel={(() => { const option = props.modelOptions.find(option => option.value === chat.model); return option ? catalogModelName(option) || 'Claude' : chat.model === 'default' ? 'Claude' : chat.model; })()}
      onUpdate={patch => collection.update(chat.id, patch)} onSend={content => collection.send(chat.id, content)} onStop={() => collection.stop(chat.id)} onDelete={() => collection.remove(chat.id)} />)}
    {props.active && (error || collection.error) && <div role="alert" className="side-chat-notice">{error || t('sideChat.loadFailed')}<button type="button" onClick={() => { setError(''); void collection.refresh(); }}>{t('sideChat.retry')}</button></div>}
  </>;
}
