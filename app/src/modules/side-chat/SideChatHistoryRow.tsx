import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SideChat } from '@/shared/types';

type Props = { chat: SideChat; number: number; onJump: () => void; onOpen: () => void; onCopy: () => void; onExport: () => void; onDelete: () => void };

/** Used by SideChatInspector; previews and menus escape the inspector's clipped scroll area. */
export function SideChatHistoryRow({ chat, number, onJump, onOpen, onCopy, onExport, onDelete }: Props) {
  const { t } = useTranslation('common');
  const rowRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  // Fixed overlays use the hovered row's viewport position, even inside a clipped sidebar.
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setMenu(null); triggerRef.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [menu]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const show = () => { clearTimeout(hideTimer.current); setPreview(rowRef.current?.getBoundingClientRect() || null); };
  const hide = () => { hideTimer.current = setTimeout(() => setPreview(null), 120); };
  const invoke = (action: () => void) => { setMenu(null); setPreview(null); action(); };
  const width = Math.min(420, window.innerWidth - 24);
  return <div ref={rowRef} className="side-chat-history-row" onPointerEnter={show} onPointerLeave={hide}
    onFocus={show} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) hide(); }}>
    <button type="button" className="side-chat-number" title={t('sideChat.jump')} aria-label={`${t('sideChat.jump')} ${number}`} onClick={onJump}>{number}</button>
    <div className="side-chat-row-text" tabIndex={0}><span>{chat.source.text}</span>{chat.status === 'running' && <i className="side-chat-running" aria-label={t('sideChat.generating')} />}</div>
    <button ref={triggerRef} type="button" title={t('sideChat.more')} aria-label={`${t('sideChat.more')} ${number}`} aria-haspopup="menu" aria-expanded={Boolean(menu)}
      onClick={() => { setPreview(null); setMenu(menu ? null : triggerRef.current!.getBoundingClientRect()); }}><MoreHorizontal size={16} /></button>
    <button type="button" title={t('sideChat.delete')} aria-label={`${t('sideChat.delete')} ${number}`} onClick={onDelete}><Trash2 size={15} /></button>
    {preview && !menu && createPortal(<div role="tooltip" className="side-chat-row-preview" onPointerEnter={() => clearTimeout(hideTimer.current)} onPointerLeave={hide}
      style={{ display: 'block', position: 'fixed', width, left: Math.max(8, Math.min(preview.left - width - 10, window.innerWidth - width - 8)), top: Math.max(8, Math.min(preview.top, window.innerHeight - 340)) }}>
      <small>{t('sideChat.questions')}</small>{chat.messages.filter(message => message.role === 'user').map(message => <p key={message.id}>{message.content}</p>)}
      {!chat.messages.some(message => message.role === 'user') && <p>{chat.source.text}</p>}
    </div>, document.body)}
    {menu && createPortal(<div data-side-chat-surface="true" ref={menuRef} role="menu" className="side-chat-menu" style={{ position: 'fixed', left: Math.max(8, Math.min(menu.right - 165, window.innerWidth - 173)), top: Math.max(8, Math.min(menu.bottom + 4, window.innerHeight - 135)) }}>
      <button role="menuitem" onClick={() => invoke(onOpen)}>{t('sideChat.expand')}</button>
      <button role="menuitem" onClick={() => invoke(onCopy)}>{t('sideChat.copyQuote')}</button>
      <button role="menuitem" onClick={() => invoke(onExport)}>{t('sideChat.export')}</button>
    </div>, document.body)}
  </div>;
}
