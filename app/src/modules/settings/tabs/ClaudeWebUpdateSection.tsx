import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import { useClaudeWebUpdate } from '@/modules/settings/hooks/useClaudeWebUpdate';
import { api } from '@/shared/api';
import { Button } from '@/shared/ui';

// Codes the root updater reports that have their own explanation; anything else shows the code.
const KNOWN_ERRORS = new Set([
  'CLAUDEWEB_DISK_REQUIRED', 'CLAUDEWEB_UPDATE_TOO_SOON', 'CLAUDEWEB_UPDATE_RUNNING', 'CLAUDEWEB_START_FAILED_ROLLED_BACK',
  'CLAUDEWEB_DOWNLOAD_FAILED', 'CLAUDEWEB_CATALOGUE_UNAVAILABLE', 'CLAUDEWEB_UPDATER_UNAVAILABLE', 'NOT_MAIN_DEVICE',
]);

function megabytes(bytes: number) {
  return Math.max(1, Math.round(bytes / 1024 / 1024));
}

type ClaudeWebUpdateSectionProps = {
  /** Replaced in tests; the page reloads once the new version answers. */
  reload?: () => void;
};

/**
 * Rendered by AboutTab: the installed ClaudeWeb version and, when the root updater's socket
 * is there, a check for and install of a newer stable release.
 */
export default function ClaudeWebUpdateSection({ reload }: ClaudeWebUpdateSectionProps) {
  const { t } = useTranslation('settings');
  const { phase, status, offer, error, check, update } = useClaudeWebUpdate(reload);
  const [confirming, setConfirming] = useState(false);
  // Conversations running when the confirmation opened; null until known (or when it cannot be read).
  const [running, setRunning] = useState<number | null>(null);

  const startConfirming = () => {
    setConfirming(true);
    setRunning(null);
    api.claudewebUpdate.activity()
      .then(async (response) => (response.ok ? (await response.json() as { runningConversations?: number }).runningConversations : undefined))
      .then((count) => setRunning(typeof count === 'number' ? count : null))
      .catch(() => setRunning(null));
  };

  if (phase === 'loading' || !status) return null;
  const installed = status.installed;
  const next = offer?.newer.find((item) => item.compatible) ?? null;
  const blocked = offer && !next ? offer.newer.find((item) => !item.compatible) ?? null : null;
  const busy = phase === 'checking' || phase === 'starting' || phase === 'updating' || phase === 'reloading';
  const progress = phase === 'reloading' ? 'reloading' : status.status.state;

  return (
    <SettingsSection title={t('about.update.title')}>
      <SettingsCard divided>
        <SettingsRow
          label={t('about.update.installed')}
          description={installed ? undefined : t('about.update.builtOnServer')}
        >
          <div className="flex items-center gap-3">
            <span className="text-sm tabular-nums text-foreground">{installed ?? t('about.update.unknown')}</span>
            {status.supported && (
              <Button variant="outline" size="sm" onClick={() => void check()} disabled={busy} className="gap-2">
                {phase === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t('about.update.check')}
              </Button>
            )}
          </div>
        </SettingsRow>

        {(phase === 'updating' || phase === 'reloading' || phase === 'starting') && (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t(`about.update.progress.${phase === 'starting' ? 'queued' : progress}`, { version: status.status.version ?? '' })}
          </div>
        )}

        {phase === 'ready' && offer && !next && !blocked && (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            {t('about.update.upToDate')}
          </div>
        )}

        {phase === 'ready' && blocked && (
          <div className="px-4 py-4 text-sm text-muted-foreground">
            {t('about.update.notCompatible', { version: blocked.version })}
          </div>
        )}

        {phase === 'ready' && next && (
          <div className="space-y-3 px-4 py-4">
            <div className="text-sm font-medium text-foreground">
              {t('about.update.available', { version: next.version, size: megabytes(next.download_bytes) })}
            </div>
            {next.notes && <p className="whitespace-pre-line text-sm text-muted-foreground">{next.notes}</p>}
            {confirming ? (
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/40 p-3">
                <p className="flex items-start gap-2 text-sm text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  {t('about.update.confirm')}
                </p>
                {running !== null && (
                  <p className={running > 0 ? 'text-sm font-medium text-amber-700 dark:text-amber-400' : 'text-sm text-muted-foreground'}>
                    {running > 0 ? t('about.update.running', { count: running }) : t('about.update.noneRunning')}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => { setConfirming(false); void update(next.version); }}>
                    {t('about.update.confirmButton', { version: next.version })}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>{t('about.update.cancel')}</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={startConfirming}>{t('about.update.install', { version: next.version })}</Button>
            )}
          </div>
        )}

        {error && phase === 'ready' && (
          <div className="flex items-start gap-2 px-4 py-4 text-sm text-red-600 dark:text-red-400" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{KNOWN_ERRORS.has(error) ? t(`about.update.errors.${error}`) : t('about.update.errors.other', { code: error })}</span>
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
