import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText, RefreshCw, Trash2, X } from 'lucide-react';

import { api, readApiJson } from '@/shared/api';
import { formatByteSize } from '@/shared/byteSize';
import { pickFileDownload } from '@/shared/utils';
import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import { formatExactTime } from '@/shared/timeFormat';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { fileTypeLabel } from '@/modules/sidebar/utils/projectFiles';
import type { ProjectUploadedFile as ProjectFile } from '@/shared/types';

type ProjectFilesPageProps = {
  /** The project whose uploads are shown, or null when the page is closed. */
  project: { name: string; path: string } | null;
  onClose: () => void;
};

type LoadState = { files: ProjectFile[]; loading: boolean; error: string | null };

/**
 * The project menu's File management page: everything uploaded to chats in
 * this project, with where it is stored, when, how big and what kind, and
 * buttons to download it again or delete it from the server. Opened from the
 * sidebar as its own page over the workspace, like Settings.
 */
export default function ProjectFilesPage({ project, onClose }: ProjectFilesPageProps) {
  const { t, i18n } = useTranslation('sidebar');
  const open = project !== null;
  const { isPresent, presenceProps } = useSurfacePresence(open);
  // The last project stays on screen through the closing animation.
  const [shown, setShown] = useState(project);
  if (project && project !== shown) setShown(project);
  // Server results and loading failures for the currently displayed project's files.
  const [state, setState] = useState<LoadState>({ files: [], loading: true, error: null });
  // Disable file actions while a download or deletion is running.
  const [busyName, setBusyName] = useState<string | null>(null);
  // A file is deleted only after the confirmation dialog is accepted.
  const [pendingDelete, setPendingDelete] = useState<ProjectFile | null>(null);
  const loadGenerationRef = useRef(0);
  const projectPath = project?.path ?? null;

  const load = useCallback(async (fresh = false) => {
    if (!projectPath) return;
    const generation = ++loadGenerationRef.current;
    setState((previous) => ({ files: fresh ? [] : previous.files, loading: true, error: null }));
    try {
      const { files } = await readApiJson<{ files: ProjectFile[] }>(await api.assets.projectFiles(projectPath));
      if (generation !== loadGenerationRef.current) return;
      setState({ files: Array.isArray(files) ? files : [], loading: false, error: null });
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        error: error instanceof Error && error.message ? error.message : t('workspace.projectFiles.loadFailed'),
      }));
    }
  }, [projectPath, t]);

  // Each opening starts from a fresh list; `load` shows the loading state itself.
  useEffect(() => {
    if (projectPath) void load(true);
    return () => { loadGenerationRef.current += 1; };
  }, [projectPath, load]);

  // Escape closes the page unless a layer on top of it (the delete confirmation) takes it first.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-escape-layer]')) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const backdropMouseDownRef = useRef(false);
  const onBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    backdropMouseDownRef.current = event.target === event.currentTarget;
  };
  const onBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const startedOnBackdrop = backdropMouseDownRef.current;
    backdropMouseDownRef.current = false;
    if (startedOnBackdrop && event.target === event.currentTarget) onClose();
  };

  const download = async (file: ProjectFile) => {
    setBusyName(file.storedName);
    try {
      const destination = await pickFileDownload(file.name);
      if (!destination) return;
      const response = await api.assets.downloadProjectFile(file.storedName);
      if (!response.ok) await readApiJson(response);
      await destination.save(await response.blob());
    } catch (error) {
      setState((previous) => ({
        ...previous,
        error: error instanceof Error && error.message ? error.message : t('workspace.projectFiles.downloadFailed'),
      }));
    } finally {
      setBusyName(null);
    }
  };

  const confirmDelete = async () => {
    const file = pendingDelete;
    setPendingDelete(null);
    if (!file) return;
    setBusyName(file.storedName);
    try {
      await readApiJson(await api.assets.deleteProjectFile(file.storedName));
      setState((previous) => ({ ...previous, files: previous.files.filter((item) => item.storedName !== file.storedName) }));
    } catch (error) {
      setState((previous) => ({
        ...previous,
        error: error instanceof Error && error.message ? error.message : t('workspace.projectFiles.deleteFailed'),
      }));
    } finally {
      setBusyName(null);
    }
  };

  if (!isPresent || !shown) return null;

  const totalSize = state.files.reduce((sum, file) => sum + (file.exists ? file.size : 0), 0);
  const title = t('workspace.projectFiles.title');

  return (
    <div
      className="motion-modal modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm md:p-4"
      {...presenceProps}
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} · ${shown.name}`}
        className="motion-modal-panel project-files-page flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl"
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
          <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
            {title}
            <span className="project-files-project"> · {shown.name}</span>
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={state.loading}
              aria-label={t('workspace.projectFiles.refresh')}
              title={t('workspace.projectFiles.refresh')}
              className="h-10 w-10 p-0 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label={t('workspace.projectFiles.close')}
              className="h-10 w-10 p-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <p className="project-files-summary">
            {t('workspace.projectFiles.summary', { count: state.files.length, size: formatByteSize(totalSize) })}
            <span>{t('workspace.projectFiles.storedIn')}</span>
          </p>
          {state.error && <p className="project-files-error" role="alert">{state.error}</p>}
          <div className="project-files-table" role="table" aria-label={title}>
            <div className="project-files-row project-files-head" role="row">
              <span role="columnheader">{t('workspace.projectFiles.columns.name')}</span>
              <span role="columnheader">{t('workspace.projectFiles.columns.uploadedAt')}</span>
              <span role="columnheader">{t('workspace.projectFiles.columns.size')}</span>
              <span role="columnheader">{t('workspace.projectFiles.columns.type')}</span>
              <span role="columnheader" className="project-files-actions-head">{t('workspace.projectFiles.columns.actions')}</span>
            </div>
            {state.loading && !state.files.length && (
              <p className="project-files-note">{t('workspace.projectFiles.loading')}</p>
            )}
            {!state.loading && !state.error && !state.files.length && (
              <p className="project-files-note">{t('workspace.projectFiles.empty')}</p>
            )}
            {state.files.map((file) => (
              <div className={`project-files-row ${file.exists ? '' : 'missing'}`} role="row" key={file.storedName}>
                <span role="cell" className="project-files-name">
                  <FileText size={16} aria-hidden />
                  <span>
                    <strong title={file.name}>{file.name}</strong>
                    <small title={file.path}>{file.path}</small>
                    {!file.exists && <em>{t('workspace.projectFiles.missing')}</em>}
                  </span>
                </span>
                <span role="cell" className="project-files-time">{formatExactTime(file.uploadedAt, i18n.language)}</span>
                <span role="cell" className="project-files-size">{formatByteSize(file.size)}</span>
                <span role="cell" className="project-files-type" title={file.mimeType ?? undefined}>{fileTypeLabel(file)}</span>
                <span role="cell" className="project-files-actions">
                  <button
                    type="button"
                    disabled={!file.exists || busyName !== null}
                    onClick={() => void download(file)}
                    aria-label={t('workspace.projectFiles.downloadNamed', { name: file.name })}
                    title={t('workspace.projectFiles.download')}
                  >
                    <Download size={15} />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busyName !== null}
                    onClick={() => setPendingDelete(file)}
                    aria-label={t('workspace.projectFiles.deleteNamed', { name: file.name })}
                    title={t('workspace.projectFiles.delete')}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </main>
      </div>

      <Dialog open={pendingDelete !== null} onOpenChange={(value) => { if (!value) setPendingDelete(null); }}>
        <DialogContent
          className="workspace-account-dialog"
          wrapperClassName="z-[10000]"
          aria-label={t('workspace.projectFiles.deleteTitle')}
          data-escape-layer
        >
          <DialogTitle>{t('workspace.projectFiles.deleteTitle')}</DialogTitle>
          <p>{t('workspace.projectFiles.deleteConfirm', { name: pendingDelete?.name ?? '' })}</p>
          <div className="settings-archive-confirm">
            <button type="button" onClick={() => setPendingDelete(null)}>{t('workspace.projectFiles.cancel')}</button>
            <button type="button" className="danger" onClick={() => void confirmDelete()}>{t('workspace.projectFiles.delete')}</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
