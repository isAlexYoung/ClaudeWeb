import { AlertTriangle, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type OverwriteConfirmModalProps = {
  isOpen: boolean;
  fileName: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Opened by PRDEditor inside the prd-editor module to confirm overwriting a PRD file that already exists. */
export default function OverwriteConfirmModal({
  isOpen,
  fileName,
  saving,
  onCancel,
  onConfirm,
}: OverwriteConfirmModalProps) {
  const { t } = useTranslation('tasks');
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />

      <div role="alertdialog" aria-modal="true" aria-label={t('prdEditor.overwrite.title')}
        className="relative w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900/40">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-base font-semibold text-foreground">{t('prdEditor.overwrite.title')}</h3>
        </div>

        <p className="mb-6 text-sm text-muted-foreground">{t('prdEditor.overwrite.message', { fileName })}</p>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50">
            {t('prdEditor.overwrite.cancel')}
          </button>
          <button type="button" onClick={onConfirm} disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
            <Save className="h-4 w-4" />
            <span>{saving ? t('prdEditor.saving') : t('prdEditor.overwrite.confirm')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
