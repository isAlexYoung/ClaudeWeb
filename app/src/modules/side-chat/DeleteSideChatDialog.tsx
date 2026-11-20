import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/** Used by the floating window and inspector for the same explicit deletion confirmation. */
export function DeleteSideChatDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  return createPortal(<div data-side-chat-surface="true" className="side-chat-confirm-overlay" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') onCancel();
    if (event.key === 'Tab') {
      const buttons = ref.current?.querySelectorAll('button');
      if (buttons?.length) { event.preventDefault(); (document.activeElement === buttons[0] ? buttons[1] : buttons[0]).focus(); }
    }
  }}><div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="side-chat-delete-title" aria-describedby="side-chat-delete-description" className="side-chat-confirm">
    <h3 id="side-chat-delete-title">{t('sideChat.confirmDelete')}</h3><p id="side-chat-delete-description">{t('sideChat.deleteDescription')}</p>
    <footer><button type="button" onClick={onCancel}>{t('sideChat.no')}</button><button type="button" onClick={onConfirm}>{t('sideChat.yes')}</button></footer>
  </div></div>, document.body);
}
