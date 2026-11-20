import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, readApiErrorMessage } from '@/shared/api';
import type { TaskMasterProject } from '@/shared/types';

type TaskMasterSetupModalProps = {
  isOpen: boolean;
  project: TaskMasterProject | null;
  onClose: () => void;
  onAfterClose?: (() => void) | null;
};

type SetupResult = {
  phase: 'idle' | 'running' | 'complete' | 'failed';
  output?: string;
  warning?: string;
  error?: string;
};

function ProjectSetup({ project, onClose, onAfterClose }: {
  project: TaskMasterProject;
  onClose: () => void;
  onAfterClose?: (() => void) | null;
}) {
  const { t } = useTranslation('tasks');
  // Keep each project's request outcome together so a failure is retryable without losing its explanation.
  const [result, setResult] = useState<SetupResult>({ phase: 'idle' });
  const initializing = result.phase === 'running';
  const completed = result.phase === 'complete';

  const initialize = async () => {
    setResult({ phase: 'running' });
    try {
      const response = await api.taskmaster.initialize(project.projectId);
      const payload = await response.json() as { output?: string; warning?: string; message?: string };
      if (!response.ok) throw new Error(readApiErrorMessage(payload) ?? t('setupModal.failed'));
      setResult({ phase: 'complete', output: payload.output, warning: payload.warning });
    } catch (error) {
      setResult({ phase: 'failed', error: error instanceof Error ? error.message : t('setupModal.failed') });
    }
  };
  const close = () => {
    onClose();
    if (completed) onAfterClose?.();
  };

  return (
    <div data-escape-layer role="dialog" aria-modal="true" aria-label={t('setupModal.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 text-foreground shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t('setupModal.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('setupModal.subtitle', { projectName: project.displayName })}</p>
          </div>
          <button type="button" onClick={close} disabled={initializing} aria-label={t('setupModal.closeButton')}
            className="rounded p-1 hover:bg-muted disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <p className="my-5 text-sm text-muted-foreground">{t('setupModal.apiDescription')}</p>
        {initializing && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{t('setupModal.initializing')}</p>}
        {completed && <p role="status" className="flex items-center gap-2 text-sm"><Check className="h-4 w-4" />{t('setupModal.completed')}</p>}
        {result.error && <p role="alert" className="mt-3 text-sm text-destructive">{result.error}</p>}
        {result.warning && <p role="alert" className="mt-3 text-sm text-amber-600 dark:text-amber-400">{result.warning}</p>}
        {result.output && <details className="mt-3 text-sm"><summary className="cursor-pointer">{t('setupModal.output')}</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{result.output}</pre>
        </details>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={close} disabled={initializing} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">
            {completed ? t('setupModal.closeContinueButton') : t('setupModal.closeButton')}
          </button>
          {!completed && <button type="button" disabled={initializing} onClick={() => { void initialize(); }}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{t('setupModal.initializeButton')}</button>}
        </div>
      </div>
    </div>
  );
}

/** Used by the task board, next-task banner and chat add menu to initialize through the installed server CLI. */
export default function TaskMasterSetupModal({ isOpen, project, onClose, onAfterClose = null }: TaskMasterSetupModalProps) {
  if (!isOpen || !project) return null;
  return <ProjectSetup key={project.projectId} project={project} onClose={onClose} onAfterClose={onAfterClose} />;
}
