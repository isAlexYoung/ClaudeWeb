import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

/** Used by ChatMessagesPane for a whole response's reasoning, progress prose and tool groups. */
export function ResponseProcess({ running, children }: { running: boolean; children: ReactNode }) {
  const { t } = useTranslation('chat');
  // A live process starts expanded; the user's collapse choice survives every streaming update.
  const [open, setOpen] = useState(running);
  return <details className="workspace-response-process" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={14} /><span>{t(running ? 'responseProcess.running' : 'responseProcess.label')}</span></summary>
    <div className="workspace-response-process-content space-y-3">{children}</div>
  </details>;
}
