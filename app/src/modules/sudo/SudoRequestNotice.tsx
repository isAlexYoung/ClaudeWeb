import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { Button } from '@/shared/ui';

/** A sudo request as the server lists it: the arguments after `sudo`, exactly as they will run. */
export type SudoRequest = { id: string; argv: string[]; cwd: string; createdAt: number; expiresAt: number };

/** The command line as a shell would show it, quoting only what needs it. */
export function shellLine(argv: string[]): string {
  return ['sudo', ...argv].map((part) => (/^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`)).join(' ');
}

async function fetchRequests(): Promise<SudoRequest[]> {
  try {
    const response = await api.sudo.requests();
    if (!response.ok) return [];
    const data = (await response.json()) as { requests?: unknown };
    return Array.isArray(data.requests) ? (data.requests as SudoRequest[]) : [];
  } catch {
    return [];
  }
}

function RequestCard({ request, onAnswered }: { request: SudoRequest; onAnswered: () => void }) {
  const { t } = useTranslation('common');
  // The password lives only in this field's state, and is cleared once sent.
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(() => Math.max(0, Math.round((request.expiresAt - Date.now()) / 1000)));

  useEffect(() => {
    const timer = window.setInterval(() => setLeft(Math.max(0, Math.round((request.expiresAt - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [request.expiresAt]);

  const answer = async (approve: boolean) => {
    if (approve && !password) {
      setError(t('sudo.passwordRequired'));
      return;
    }
    setBusy(true);
    setError('');
    const sent = approve ? password : undefined;
    setPassword('');
    try {
      const response = await api.sudo.answer(request.id, approve ? { approve: true, password: sent } : { approve: false });
      if (!response.ok) setError(t(response.status === 404 ? 'sudo.gone' : 'sudo.failed'));
    } catch {
      setError(t('sudo.failed'));
    } finally {
      setBusy(false);
      onAnswered();
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void answer(true);
  };

  return (
    <form onSubmit={submit} role="alertdialog" aria-label={t('sudo.title')} data-testid="sudo-request"
      className="pointer-events-auto rounded-xl border border-amber-500/60 bg-popover p-3 text-sm text-popover-foreground shadow-lg">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="font-medium">{t('sudo.title')}</div>
          <code className="block max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-xs">
            {shellLine(request.argv)}
          </code>
          <div className="text-xs text-muted-foreground">{t('sudo.where', { cwd: request.cwd, seconds: left })}</div>
          <input type="password" autoComplete="off" spellCheck={false} value={password} disabled={busy}
            onChange={(event) => setPassword(event.target.value)} placeholder={t('sudo.passwordPlaceholder')}
            aria-label={t('sudo.passwordPlaceholder')}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
          {error && <div role="alert" className="text-xs text-red-500">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>{t('sudo.deny')}</Button>
            <Button type="submit" size="sm" variant="destructive" disabled={busy}>{t('sudo.allow')}</Button>
          </div>
          <div className="text-[11px] text-muted-foreground">{t('sudo.note')}</div>
        </div>
      </div>
    </form>
  );
}

/**
 * Mounted by App while signed in: shows the sudo commands Claude is waiting
 * to run. Allowing one needs the sudo password, which goes to sudo once;
 * the page keeps it nowhere.
 */
export default function SudoRequestNotice() {
  const { subscribe } = useWebSocket();
  const [requests, setRequests] = useState<SudoRequest[]>([]);
  const refresh = useCallback(async () => { setRequests(await fetchRequests()); }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => subscribe((event) => {
    if (event.kind === 'sudo_requests_changed' || event.kind === 'websocket_reconnected') void refresh();
  }), [refresh, subscribe]);

  if (!requests.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[1001] flex w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-2">
      {requests.map((request) => <RequestCard key={request.id} request={request} onAnswered={() => void refresh()} />)}
    </div>
  );
}
