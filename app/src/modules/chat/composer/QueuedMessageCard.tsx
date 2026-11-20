import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Loader2, Pencil, X } from 'lucide-react';

type QueuedMessageCardProps = {
  content: string;
  attachmentCount?: number;
  onEdit: () => void;
  onDelete: () => void;
  onSendNow?: () => void;
  onSave?: (content: string | null) => Promise<void>;
  sending?: boolean;
  error?: string | null;
};

/** Used by ChatComposer to explain the persisted queue and expose edit, cancel and interrupt/send actions. */
export default function QueuedMessageCard({ content, attachmentCount = 0, onEdit, onDelete, onSendNow, onSave, sending = false, error }: QueuedMessageCardProps) {
  const { t } = useTranslation('chat');
  // Inline editing keeps uploaded descriptors and any separate composer draft untouched.
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(content);
  const save = async (text: string | null) => {
    try { await onSave?.(text); setEditing(false); } catch { /* The parent renders the request error. */ }
  };
  return (
    <div className="workspace-queued-message mx-auto mb-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <p className="font-medium text-foreground">{t('input.queue.willSend')}</p>
      {editing ? <div className="mt-2">
        <textarea aria-label={t('input.queue.edit')} value={editedText} onChange={event => setEditedText(event.target.value)}
          disabled={sending} className="min-h-24 w-full resize-y rounded-lg border border-border bg-background p-2 text-sm" />
        <p className="text-xs text-muted-foreground">{t('input.queue.editHint')}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={sending || (!editedText.trim() && attachmentCount === 0)} onClick={() => void save(editedText)} className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50">{t('input.queue.save')}</button>
          <button type="button" disabled={sending} onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 hover:bg-muted">{t('input.queue.discard')}</button>
        </div>
      </div> : <p tabIndex={0} className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground">{content}</p>}
      {attachmentCount > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('input.queue.attachments', { count: attachmentCount })}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={sending} onClick={() => { if (onSave) { setEditedText(content); setEditing(true); } else onEdit(); }} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-muted disabled:opacity-50">
          <Pencil size={14} />{t('input.queue.edit')}
        </button>
        <button type="button" disabled={sending} onClick={() => onSave ? void save(null) : onDelete()} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-muted disabled:opacity-50">
          <X size={14} />{t('input.queue.cancel')}
        </button>
        {onSendNow && !editing && <button type="button" disabled={sending} onClick={onSendNow}
          title={t('input.queue.sendNowDescription')}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
          {t('input.queue.sendNow')}
        </button>}
      </div>
    </div>
  );
}
