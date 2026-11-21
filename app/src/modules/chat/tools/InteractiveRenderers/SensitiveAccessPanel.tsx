import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatToolInputForDisplay } from '@/modules/chat/utils/chatPermissions';
import type { PermissionPanelProps } from '@/shared/types';

const KINDS = ['claudeCredentials', 'browserData', 'claudewebData', 'claudewebSettings', 'signingKey'] as const;

/**
 * Shown when one of Claude's tool calls would read or send the user's
 * sensitive information (the server's list in modules/sensitive-access).
 * Allowing answers for this one call; nothing is remembered.
 */
export function SensitiveAccessPanel({ request, onDecision }: PermissionPanelProps) {
  const { t } = useTranslation('chat');
  const input = (request.input ?? {}) as { toolName?: unknown; toolInput?: unknown; kinds?: unknown };
  const kinds = Array.isArray(input.kinds) ? input.kinds.filter((kind): kind is (typeof KINDS)[number] => KINDS.includes(kind)) : [];
  const toolName = typeof input.toolName === 'string' ? input.toolName : '';
  const details = formatToolInputForDisplay(input.toolInput);

  return (
    <div role="alertdialog" aria-label={t('sensitiveAccess.title')} data-testid="sensitive-access"
      className="rounded-xl border border-red-500/50 bg-red-500/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="font-medium text-foreground">{t('sensitiveAccess.title')}</div>
          <div className="text-foreground">{t('sensitiveAccess.description')}</div>
          <ul className="list-inside list-disc text-foreground">
            {kinds.map((kind) => <li key={kind}>{t(`sensitiveAccess.kinds.${kind}`)}</li>)}
          </ul>
          {toolName && (
            <div className="text-xs text-muted-foreground">
              {t('sensitiveAccess.tool')} <code className="rounded bg-muted px-1.5 py-0.5">{toolName}</code>
            </div>
          )}
          {details && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 text-xs text-muted-foreground">{details}</pre>
          )}
          <div className="text-[11px] text-muted-foreground">{t('sensitiveAccess.limits')}</div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              onClick={() => onDecision(request.requestId, { allow: false, message: t('sensitiveAccess.refused') })}>
              {t('sensitiveAccess.refuse')}
            </button>
            <button type="button" className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
              onClick={() => onDecision(request.requestId, { allow: true })}>
              {t('sensitiveAccess.allowOnce')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
