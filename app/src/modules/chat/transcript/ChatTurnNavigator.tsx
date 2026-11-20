import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '@/shared/types';
import { parseQuotedQuestion } from '@/shared/utils';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import '@/modules/chat/transcript/chat-turn-navigator.css';

/** Fixed hit targets keep the rail stable while its decorative bars magnify. */
const TURN_PITCH = 12;
const OVERSCAN = 5;

type ChatTurnNavigatorProps = {
  messages: ChatMessage[];
  scrollContainerRef: RefObject<HTMLDivElement>;
  hasOlderMessages: boolean;
  loadHistory: () => Promise<ChatMessage[]>;
  onReveal: (message: ChatMessage, navigationKey?: string) => void;
};

/** Used by ChatInterface to navigate user turns without rendering their offscreen markdown. */
function ChatTurnNavigator({ messages, scrollContainerRef, hasOlderMessages, loadHistory, onReveal }: ChatTurnNavigatorProps) {
  const { t } = useTranslation('chat');
  const previewId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointerFrameRef = useRef(0);
  const pointerValueRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const requestRef = useRef<Promise<void> | null>(null);
  const anchorRef = useRef<{ first: string; bottom: boolean }>({ first: '', bottom: true });
  // Pointer position is committed at most once per frame; the transcript never re-renders with the wave.
  const [pointerY, setPointerY] = useState<number | null>(null);
  // Keyboard focus selects the same preview as a pointer without creating another tab stop per turn.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // Only the viewport's visible slice is mounted, even with thousands of user turns.
  const [metrics, setMetrics] = useState({ top: 0, height: 0 });
  // The current marker follows the conversation scroll position independently of the rail scroll.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // History is requested on interaction, with a real loading skeleton and a retry on the next interaction.
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const turns = useMemo(() => {
    const occurrences = new Map<string, number>();
    return messages.filter(message => message.type === 'user' && !message.isCompactSummary && !message.isTaskNotification).map(message => {
      const base = getIntrinsicMessageKey(message) ?? 'message-generated';
      const seen = occurrences.get(base) ?? 0;
      occurrences.set(base, seen + 1);
      return { message, key: seen ? `${base}__${seen}` : base };
    });
  }, [messages]);

  const measure = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = { top: viewport.scrollTop, height: viewport.clientHeight };
    anchorRef.current.bottom = viewport.scrollHeight - next.top - next.height < TURN_PITCH;
    setMetrics(previous => previous.top === next.top && previous.height === next.height ? previous : next);
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelAnimationFrame(pointerFrameRef.current);
    };
  }, []);

  const firstKey = turns[0]?.key ?? '';
  // Preserve the item under the pointer when older history is prepended; follow new turns only at the end.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const previous = anchorRef.current;
    const prepended = previous.first ? turns.findIndex(turn => turn.key === previous.first) : 0;
    if (previous.bottom) viewport.scrollTop = viewport.scrollHeight;
    else if (prepended > 0) viewport.scrollTop += prepended * TURN_PITCH;
    anchorRef.current.first = firstKey;
    measure();
  // A streaming assistant update cannot change the rail's geometry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length, firstKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (anchorRef.current.bottom) viewport.scrollTop = viewport.scrollHeight;
      measure();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [turns.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !turns.length) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchor = container.getBoundingClientRect().top + Math.min(100, container.clientHeight / 4);
        let current: HTMLElement | null = null;
        for (const row of container.querySelectorAll<HTMLElement>('[data-user-turn-key]')) {
          if (!current) current = row;
          if (row.getBoundingClientRect().top <= anchor) current = row;
          else break;
        }
        if (current) setActiveKey(current.getAttribute('data-user-turn-key'));
      });
    };
    update();
    container.addEventListener('scroll', update, { passive: true });
    container.addEventListener('load', update, true);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', update);
      container.removeEventListener('load', update, true);
    };
  }, [scrollContainerRef, turns.length]);

  const ensureHistory = () => {
    if (!hasOlderMessages || historyState === 'ready' || requestRef.current) return;
    setHistoryState('loading');
    requestRef.current = loadHistory().then(() => {
      if (aliveRef.current) setHistoryState('ready');
    }).catch(() => {
      if (aliveRef.current) setHistoryState('error');
    }).finally(() => { requestRef.current = null; });
  };

  const hoveredIndex = pointerY === null ? turns.findIndex(turn => turn.key === focusedKey)
    : Math.max(0, Math.min(turns.length - 1, Math.floor((metrics.top + pointerY) / TURN_PITCH)));
  const hovered = turns[hoveredIndex];
  const start = Math.max(0, Math.floor(metrics.top / TURN_PITCH) - OVERSCAN);
  const end = Math.min(turns.length, Math.ceil((metrics.top + (metrics.height || 600)) / TURN_PITCH) + OVERSCAN);
  const visibleTurns = turns.slice(start, end);
  const tabKey = visibleTurns.find(turn => turn.key === focusedKey)?.key || visibleTurns.find(turn => turn.key === activeKey)?.key || visibleTurns[visibleTurns.length - 1]?.key;
  const content = hovered?.message.content ? parseQuotedQuestion(hovered.message.content).input.trim() : '';
  const attachments = hovered ? [...(hovered.message.files ?? []).map(file => file.name), ...(hovered.message.images ?? []).map(image => image.name)].filter(Boolean).join('、') : '';
  const attachmentCount = (hovered?.message.images?.length ?? 0) + (hovered?.message.files?.length ?? 0);
  const preview = (content || attachments || (attachmentCount ? t('turnNavigator.attachments', { count: attachmentCount }) : t('turnNavigator.empty'))).slice(0, 1200);
  const loading = historyState === 'loading' || Boolean(hovered && typeof hovered.message.content !== 'string' && !attachments);
  const focus = (index: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = Math.max(0, Math.min(turns.length - 1, index));
    setFocusedKey(turns[next].key);
    setPointerY(null);
    if (next * TURN_PITCH < viewport.scrollTop) viewport.scrollTop = next * TURN_PITCH;
    else if ((next + 1) * TURN_PITCH > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = (next + 1) * TURN_PITCH - viewport.clientHeight;
    measure();
    requestAnimationFrame(() => viewport.querySelector<HTMLButtonElement>(`[data-turn-index="${next}"]`)?.focus());
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.currentTarget.blur();
      setFocusedKey(null);
      setPointerY(null);
      return;
    }
    const target = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? turns.length - 1 : null;
    if (target !== null) { event.preventDefault(); focus(target); }
  };

  if (!turns.length) return null;
  return (
    <nav className="chat-turn-navigator" aria-label={t('turnNavigator.label')}>
      <div ref={viewportRef} className="chat-turn-viewport" style={{ height: turns.length * TURN_PITCH }}
        data-fade-top={metrics.top > 1 || undefined}
        data-fade-bottom={metrics.top + metrics.height < turns.length * TURN_PITCH - 1 || undefined}
        onScroll={measure} onWheel={event => event.stopPropagation()}
        onMouseEnter={ensureHistory}
        onMouseMove={event => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          pointerValueRef.current = Math.max(0, Math.min(viewport.clientHeight - 1, event.clientY - viewport.getBoundingClientRect().top));
          if (pointerFrameRef.current) return;
          pointerFrameRef.current = requestAnimationFrame(() => { pointerFrameRef.current = 0; setPointerY(pointerValueRef.current); });
        }}
        onMouseLeave={() => { cancelAnimationFrame(pointerFrameRef.current); pointerFrameRef.current = 0; pointerValueRef.current = null; setPointerY(null); }}
      >
        <div className="chat-turn-track" style={{ height: turns.length * TURN_PITCH }}>
          {visibleTurns.map((turn, offset) => {
            const index = start + offset;
            const center = index * TURN_PITCH + TURN_PITCH / 2 - metrics.top;
            const distance = pointerY === null ? Math.abs(index - hoveredIndex) * TURN_PITCH : Math.abs(center - pointerY);
            const influence = hovered ? Math.exp(-Math.pow(distance / 32, 2)) : 0;
            const current = turn.key === activeKey;
            const width = Math.max(current ? 12 : 6, 6 + 25 * influence);
            return <button key={turn.key} type="button" className="chat-turn-marker" data-turn-index={index}
              data-selected={current || undefined} aria-current={current ? 'location' : undefined}
              aria-label={t('turnNavigator.jump', { number: index + 1 })}
              aria-describedby={hovered?.key === turn.key ? previewId : undefined}
              tabIndex={turn.key === tabKey ? 0 : -1}
              style={{ top: index * TURN_PITCH, '--turn-scale': width / 32, '--turn-opacity': current ? 1 : 0.35 + 0.65 * influence } as CSSProperties}
              onFocus={event => { if (pointerValueRef.current === null || event.currentTarget.matches(':focus-visible')) setFocusedKey(turn.key); ensureHistory(); }}
              onBlur={() => setFocusedKey(null)} onKeyDown={event => handleKey(event, index)}
              onClick={() => { setActiveKey(turn.key); onReveal(turn.message, turn.key); }}
            ><i aria-hidden="true" /></button>;
          })}
        </div>
      </div>
      {hovered && <div id={previewId} role="tooltip" className="chat-turn-preview"
        style={{ top: `clamp(64px, calc(50% - ${metrics.height / 2}px + ${(hoveredIndex + 0.5) * TURN_PITCH - metrics.top}px), calc(100% - 64px))` }}>
        {loading ? <div className="chat-turn-skeleton" role="status" aria-label={t('turnNavigator.loading')}><i /><i /><i /><i /></div>
          : <p dir="auto">{preview}</p>}
        {historyState === 'error' && <small>{t('turnNavigator.historyUnavailable')}</small>}
      </div>}
    </nav>
  );
}

export default memo(ChatTurnNavigator);
