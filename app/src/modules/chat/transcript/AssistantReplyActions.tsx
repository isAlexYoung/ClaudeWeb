import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcwIcon } from 'lucide-react';

import type { ChatMessage } from '@/shared/types';
import MessageCopyControl from '@/modules/chat/transcript/MessageCopyControl';
import MessageModelLabel from '@/modules/chat/transcript/MessageModelLabel';
import MessageTime from '@/modules/chat/transcript/MessageTime';

/** Used by MessageComponent exports and ChatMessagesPane's single response footer. */
export const AssistantReplyActions = memo(function AssistantReplyActions({ message, content, model = message.model, canCopy = true, isExporting = false, regenerateFrom, onRegenerateMessage }: {
  message: ChatMessage; content: string; model?: string; canCopy?: boolean; isExporting?: boolean;
  regenerateFrom?: ChatMessage; onRegenerateMessage?: (message: ChatMessage) => void;
}) {
  const { t } = useTranslation('chat');
  return <div className="workspace-assistant-actions mt-1 flex w-full items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
    {!isExporting && canCopy && content.trim() && <MessageCopyControl content={content} messageType="assistant" />}
    {!isExporting && regenerateFrom && onRegenerateMessage && <button type="button" className="inline-flex items-center rounded px-1 py-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" title={t('regenerate.label')} aria-label={t('regenerate.label')} onClick={() => onRegenerateMessage(regenerateFrom)}><RotateCcwIcon className="h-3.5 w-3.5" /></button>}
    <MessageModelLabel model={model} />
    {!message.isStreaming && <MessageTime timestamp={message.timestamp} exact={isExporting} />}
  </div>;
});
