import { Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PRD_DOCS_URL =
  'https://github.com/eyaltoledano/claude-task-master/blob/main/docs/examples.md';

type GenerateTasksModalProps = {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
};

/** Opened by PrdEditorWorkspace inside the prd-editor module to explain how to turn the saved PRD into TaskMaster tasks. */
export default function GenerateTasksModal({
  isOpen,
  fileName,
  onClose,
}: GenerateTasksModalProps) {
  const { t } = useTranslation('tasks');
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={t('prdEditor.generate.title')} className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <Sparkles className="h-4 w-4 text-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground">{t('prdEditor.generate.title')}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t('prdEditor.close')}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">{t('prdEditor.generate.lead')}</p>
          {/* The same prompt the composer's "+" menu inserts, so both paths ask Claude for the same thing. */}
          <p className="rounded-lg border border-border bg-card p-3 font-mono text-xs text-foreground">
            {t('composerMenu.parsePrdPrompt', { fileName })}
          </p>
          <a href={PRD_DOCS_URL} target="_blank" rel="noopener noreferrer"
            className="inline-block text-sm text-muted-foreground underline hover:text-foreground">
            {t('prdEditor.generate.docs')}
          </a>
          <button type="button" onClick={onClose}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            {t('prdEditor.generate.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
