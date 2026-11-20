import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSideChats } from '@/modules/side-chat/hooks/useSideChats';
import { SideChatHistoryRow } from '@/modules/side-chat/SideChatHistoryRow';
import { DeleteSideChatDialog } from '@/modules/side-chat/DeleteSideChatDialog';
import { pickFileDownload } from '@/shared/utils';
import type { SideChat } from '@/shared/types';
import '@/modules/side-chat/side-chat.css';

/** Used by project-workspace's context inspector; conversations remain scoped to the viewed main chat. */
export function SideChatInspector({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation('common');
  const collection = useSideChats(sessionId);
  // Collapsed on first entry and on switching the parent conversation.
  const [open, setOpen] = useState(false);
  // Only one row menu or deletion confirmation may be active at a time.
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => { setOpen(false); setActionError(''); setDeleting(null); }, [sessionId]);
  const report = (error: unknown) => { console.error('[Side chats]', error); setActionError(t('sideChat.actionFailed')); };
  const exportChat = async (chat: SideChat) => {
    const destination = await pickFileDownload(`side-chat-${collection.chats.indexOf(chat) + 1}.md`);
    if (destination) await destination.save(new Blob([
      `# ${t('sideChat.title')}\n\n> ${chat.source.text.replace(/\n/g, '\n> ')}\n\n`,
      chat.messages.map(m => `## ${m.role === 'user' ? t('sideChat.user') : 'Claude'}\n\n${m.content}`).join('\n\n'),
    ], { type: 'text/markdown;charset=utf-8' }));
  };
  return <section className="side-chat-inspector">
    <button type="button" className="workspace-inspector-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<h2>{t('sideChat.title')}</h2>
    </button>
    {open && <div className="side-chat-history">
      {collection.loading && <p role="status">{t('sideChat.loading')}</p>}
      {collection.error && <p role="alert">{t('sideChat.loadFailed')} <button onClick={() => void collection.refresh()}>{t('sideChat.retry')}</button></p>}
      {!collection.loading && !collection.chats.length && <p>{t('sideChat.empty')}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {collection.chats.map((chat, index) => <SideChatHistoryRow key={chat.id} chat={chat} number={index + 1}
        onJump={() => window.dispatchEvent(new CustomEvent('claudeweb:sidechat-jump', { detail: { parentSessionId: sessionId, id: chat.id } }))}
        onOpen={() => void collection.update(chat.id, { minimized: false }).catch(report)}
        onCopy={() => void navigator.clipboard.writeText(chat.source.text).catch(report)} onExport={() => void exportChat(chat).catch(report)} onDelete={() => setDeleting(chat.id)} />)}
    </div>}
    {deleting && <DeleteSideChatDialog onCancel={() => setDeleting(null)} onConfirm={() => { void collection.remove(deleting).catch(report); setDeleting(null); }} />}
  </section>;
}
