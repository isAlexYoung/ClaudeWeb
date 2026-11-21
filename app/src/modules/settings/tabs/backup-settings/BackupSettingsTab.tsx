import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Download, FolderX, Lock, Upload } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useBackupImport } from '@/modules/settings/hooks/useBackupImport';
import { api } from '@/shared/api';
import type { BackupImportStatus, BackupPreview } from '@/shared/types';
import { Button, Input } from '@/shared/ui';
import { cn } from '@/shared/utils';

const MIN_PASSWORD_LENGTH = 8;
// The preview entry the server uses for Claude's user settings.
const CLAUDE_USER_ID = '@claude-user';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
  );
}

function ExportSection() {
  const { t } = useTranslation('settings');
  // Whether the next export is wrapped with a password.
  const [encrypt, setEncrypt] = useState(false);
  // The password and its repetition, kept only until the download starts.
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  // Request in flight, so the button cannot start two downloads.
  const [preparing, setPreparing] = useState(false);
  // File name of the download that started, for the confirmation line.
  const [startedFile, setStartedFile] = useState<string | null>(null);
  // Validation or request failure shown under the button.
  const [error, setError] = useState<string | null>(null);
  // Project folders that can go into the backup, and the ones chosen.
  const [folders, setFolders] = useState<Array<{ path: string; name: string }>>([]);
  const [includeFiles, setIncludeFiles] = useState(false);
  const [chosenFolders, setChosenFolders] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.backup.projectFolders()
      .then(async (response) => (response.ok ? await response.json() as Array<{ path: string; name: string }> : []))
      .then((list) => { if (!cancelled) setFolders(list); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const toggleIncludeFiles = (value: boolean) => {
    setIncludeFiles(value);
    // Turning it on starts with every folder chosen; each can then be left out.
    if (value && chosenFolders.length === 0) setChosenFolders(folders.map((folder) => folder.path));
  };
  const toggleFolder = (folderPath: string) => setChosenFolders((current) => (
    current.includes(folderPath) ? current.filter((item) => item !== folderPath) : [...current, folderPath]
  ));

  const handleExport = async () => {
    setError(null);
    setStartedFile(null);
    if (encrypt && password.length < MIN_PASSWORD_LENGTH) {
      setError(t('backup.export.passwordTooShort', { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (encrypt && password !== confirmation) {
      setError(t('backup.export.passwordMismatch'));
      return;
    }
    setPreparing(true);
    try {
      const response = await api.backup.prepareExport(encrypt ? password : undefined, includeFiles ? chosenFolders : undefined);
      if (!response.ok) throw new Error('export refused');
      const { downloadId, fileName } = await response.json() as { downloadId: string; fileName: string };
      // A plain link lets the browser stream the file to disk instead of holding it in memory.
      const link = document.createElement('a');
      link.href = api.backup.downloadUrl(downloadId);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setStartedFile(fileName);
      setPassword('');
      setConfirmation('');
    } catch {
      setError(t('backup.errors.generic'));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <SettingsSection title={t('backup.export.title')} description={t('backup.export.description')}>
      <SettingsCard divided>
        <SettingsRow label={t('backup.export.encrypt')} description={t('backup.export.encryptDescription')}>
          <SettingsToggle checked={encrypt} onChange={setEncrypt} ariaLabel={t('backup.export.encrypt')} />
        </SettingsRow>
        {encrypt && (
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('backup.export.password', { count: MIN_PASSWORD_LENGTH })}
              aria-label={t('backup.export.password', { count: MIN_PASSWORD_LENGTH })}
            />
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={t('backup.export.confirm')}
              aria-label={t('backup.export.confirm')}
            />
          </div>
        )}
        <SettingsRow label={t('backup.export.projectFiles')} description={t('backup.export.projectFilesDescription')}>
          <SettingsToggle checked={includeFiles} onChange={toggleIncludeFiles} ariaLabel={t('backup.export.projectFiles')} />
        </SettingsRow>
        {includeFiles && (
          <div className="space-y-2 px-4 py-4">
            {folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('backup.export.projectFilesNone')}</p>
            ) : (
              <>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {folders.map((folder) => (
                    <li key={folder.path}>
                      <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
                          checked={chosenFolders.includes(folder.path)}
                          onChange={() => toggleFolder(folder.path)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{folder.name}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground" title={folder.path}>{folder.path}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{t('backup.export.projectFilesCount', { count: chosenFolders.length })}</p>
              </>
            )}
          </div>
        )}
        <div className="space-y-3 px-4 py-4">
          <Button onClick={handleExport} disabled={preparing} className="gap-2">
            <Download className="h-4 w-4" />
            {preparing ? t('backup.export.preparing') : t('backup.export.button')}
          </Button>
          {startedFile && <p className="text-sm text-muted-foreground">{t('backup.export.started', { fileName: startedFile })}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <p className="text-xs text-muted-foreground">{t('backup.export.includes')}</p>
          <p className="text-xs text-muted-foreground">{t('backup.export.excludes')}</p>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function PreviewPanel({
  preview,
  onApply,
  onCancel,
}: {
  preview: BackupPreview;
  onApply: (projectIds: string[]) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation('settings');
  // Projects the user unticked; everything else is imported.
  const [excluded, setExcluded] = useState<string[]>([]);
  const selected = preview.projects.filter((project) => !excluded.includes(project.id));
  const requiredBytes = selected.reduce((sum, project) => sum + project.newBytes, preview.sharedNewBytes);
  const notEnoughSpace = requiredBytes > preview.freeBytes;
  const toggle = (projectId: string) => setExcluded((current) => (
    current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]
  ));

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {preview.createdAt && t('backup.import.createdAt', { date: new Date(preview.createdAt).toLocaleString(i18n.language) })}
        {preview.encrypted && <span className="ml-2 inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" />{t('backup.import.encrypted')}</span>}
      </div>
      {preview.relocation && (
        <p className="text-sm text-muted-foreground">{t('backup.import.relocated', preview.relocation)}</p>
      )}
      {preview.projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('backup.import.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {preview.projects.map((project) => {
            const checked = !excluded.includes(project.id);
            const newSessions = project.sessionCount - project.existingSessionCount;
            // Claude's user settings are listed like a project, so they can be left out too.
            if (project.id === CLAUDE_USER_ID) {
              return (
                <li key={project.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                    <input type="checkbox" className="mt-1 h-4 w-4 flex-shrink-0 accent-primary" checked={checked} onChange={() => toggle(project.id)} />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block text-sm font-medium text-foreground">{t('backup.import.userSettings')}</span>
                      <span className="block text-xs text-muted-foreground">
                        {project.fileCount > 0
                          ? t('backup.import.userSettingsFiles', { count: project.fileCount, size: formatBytes(project.fileBytes) })
                          : t('backup.import.userSettingsExisting')}
                      </span>
                    </span>
                  </label>
                </li>
              );
            }
            return (
              <li key={project.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
                    checked={checked}
                    onChange={() => toggle(project.id)}
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block text-sm font-medium text-foreground">{project.name}</span>
                    {project.path && <span className="block truncate font-mono text-xs text-muted-foreground" title={project.path}>{project.path}</span>}
                    <span className="block text-xs text-muted-foreground">
                      {t('backup.import.sessions', { count: newSessions })}
                      {project.existingSessionCount > 0 && ` · ${t('backup.import.existing', { count: project.existingSessionCount })}`}
                    </span>
                    {project.fileCount > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {t('backup.import.files', { count: project.fileCount, size: formatBytes(project.fileBytes) })}
                      </span>
                    )}
                    {!project.pathExists && !project.fileCount && (
                      <span className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <FolderX className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                        {project.path ? t('backup.import.pathMissing') : t('backup.import.pathUnknown')}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p className={cn('text-sm', notEnoughSpace ? 'text-destructive' : 'text-muted-foreground')}>
        {t('backup.import.space', { required: formatBytes(requiredBytes), free: formatBytes(preview.freeBytes) })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onApply(selected.map((project) => project.id))} disabled={selected.length === 0 || notEnoughSpace}>
          {t('backup.import.apply', { count: selected.length })}
        </Button>
        <Button variant="outline" onClick={onCancel}>{t('backup.import.cancel')}</Button>
      </div>
    </div>
  );
}

type BackupPlugins = NonNullable<BackupPreview['plugins']>;

/** After an import: plugins the backup lists that are not installed here, each reinstalled from its source on request. */
function PluginsToReinstall({ plugins }: { plugins: BackupPlugins }) {
  const { t } = useTranslation('settings');
  // Per plugin: installing, installed, or failed.
  const [states, setStates] = useState<Record<string, 'installing' | 'installed' | 'failed'>>({});
  const missing = plugins.filter((plugin) => !plugin.installed);
  if (missing.length === 0) return null;

  const install = async (plugin: BackupPlugins[number]) => {
    setStates((current) => ({ ...current, [plugin.name]: 'installing' }));
    try {
      const response = await api.plugins.install(plugin.repoUrl);
      if (!response.ok) throw new Error('install refused');
      if (!plugin.enabled) await api.plugins.toggle(plugin.name, false);
      setStates((current) => ({ ...current, [plugin.name]: 'installed' }));
    } catch {
      setStates((current) => ({ ...current, [plugin.name]: 'failed' }));
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{t('backup.import.plugins')}</p>
      <p className="text-xs text-muted-foreground">{t('backup.import.pluginsHint')}</p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {missing.map((plugin) => {
          const state = states[plugin.name];
          return (
            <li key={plugin.name} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-foreground">{plugin.displayName || plugin.name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground" title={plugin.repoUrl}>{plugin.repoUrl}</span>
              </span>
              {state === 'installed' ? (
                <span className="text-xs text-green-600 dark:text-green-400">{t('backup.import.pluginInstalled')}</span>
              ) : (
                <Button size="sm" variant="outline" disabled={state === 'installing'} onClick={() => void install(plugin)}>
                  {state === 'installing' ? t('backup.import.pluginInstalling') : state === 'failed' ? t('backup.import.pluginRetry') : t('backup.import.pluginInstall')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PasswordPanel({ status, onSubmit, onCancel }: {
  status: BackupImportStatus;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('settings');
  // The password typed for an encrypted backup; sent once, then cleared.
  const [password, setPassword] = useState('');
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    onSubmit(password);
    setPassword('');
  };
  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Lock className="h-4 w-4" />
        {t('backup.import.passwordTitle')}
      </div>
      {status.error?.code === 'BACKUP_PASSWORD_WRONG' && (
        <p className="text-sm text-destructive" role="alert">{t('backup.errors.BACKUP_PASSWORD_WRONG')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          type="password"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('backup.import.passwordPlaceholder')}
          aria-label={t('backup.import.passwordPlaceholder')}
          className="max-w-xs"
          autoFocus
        />
        <Button type="submit" disabled={!password}>{t('backup.import.unlock')}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{t('backup.import.cancel')}</Button>
      </div>
    </form>
  );
}

function ImportSection() {
  const { t } = useTranslation('settings');
  const { view, requestError, start, submitPassword, apply, reset } = useBackupImport();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    disabled: view.step !== 'idle',
    onDrop: (files) => {
      if (files[0]) void start(files[0]);
    },
  });
  const errorText = (code: string) => t(`backup.errors.${code}`, { defaultValue: t('backup.errors.generic') });
  const status = view.step === 'server' ? view.status : null;

  let body;
  if (view.step === 'uploading') {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          {t('backup.import.uploading', { sent: formatBytes(view.sentBytes), total: formatBytes(view.totalBytes) })}
        </p>
        <ProgressBar value={view.sentBytes} total={view.totalBytes} />
        <p className="text-xs text-muted-foreground">{t('backup.import.keepOpen')}</p>
        <Button variant="outline" onClick={reset}>{t('backup.import.cancel')}</Button>
      </div>
    );
  } else if (status && (status.state === 'reading' || status.state === 'uploaded')) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-foreground">{t('backup.import.reading')}</p>
        <ProgressBar value={status.progress?.processedBytes ?? 0} total={status.progress?.totalBytes ?? status.size} />
        <Button variant="outline" onClick={reset}>{t('backup.import.cancel')}</Button>
      </div>
    );
  } else if (status?.state === 'password') {
    body = <PasswordPanel status={status} onSubmit={(password) => void submitPassword(password)} onCancel={reset} />;
  } else if (status?.state === 'ready' && status.preview) {
    body = <PreviewPanel key={status.importId} preview={status.preview} onApply={(ids) => void apply(ids)} onCancel={reset} />;
  } else if (status?.state === 'importing') {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-foreground">{t('backup.import.importing')}</p>
        <ProgressBar value={status.progress?.processedBytes ?? 0} total={status.progress?.totalBytes ?? status.size} />
        <p className="text-xs text-muted-foreground">{t('backup.import.importingHint')}</p>
      </div>
    );
  } else if (status?.state === 'done' && status.result) {
    body = (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          {t('backup.import.done', { count: status.result.restoredSessions })}
        </p>
        {status.result.skippedExistingSessions > 0 && (
          <p className="text-sm text-muted-foreground">{t('backup.import.skipped', { count: status.result.skippedExistingSessions })}</p>
        )}
        <p className="text-sm text-muted-foreground">{t('backup.import.doneHint')}</p>
        {status.preview?.plugins && <PluginsToReinstall plugins={status.preview.plugins} />}
        <Button onClick={reset}>{t('backup.import.finish')}</Button>
      </div>
    );
  } else if (status?.state === 'failed') {
    body = (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {errorText(status.error?.code ?? 'generic')}
        </p>
        <Button variant="outline" onClick={reset}>{t('backup.import.chooseAgain')}</Button>
      </div>
    );
  } else {
    body = (
      <div
        {...getRootProps()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors',
          isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
        )}
      >
        <input {...getInputProps()} aria-label={t('backup.import.drop')} />
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{isDragActive ? t('backup.import.dropActive') : t('backup.import.drop')}</p>
        <p className="text-xs text-muted-foreground">{t('backup.import.dropHint')}</p>
      </div>
    );
  }

  return (
    <SettingsSection title={t('backup.import.title')} description={t('backup.import.description')}>
      <SettingsCard className="space-y-3 p-4">
        {requestError && (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {errorText(requestError)}
          </p>
        )}
        {body}
      </SettingsCard>
    </SettingsSection>
  );
}

/**
 * Rendered by Settings for the "backup" tab: exports every Claude conversation
 * of this server to one file and imports such a file after a reinstall,
 * skipping conversations that already exist.
 */
export default function BackupSettingsTab() {
  return (
    <div className="space-y-8">
      <ExportSection />
      <ImportSection />
    </div>
  );
}
