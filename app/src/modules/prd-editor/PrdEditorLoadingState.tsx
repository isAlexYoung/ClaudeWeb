import { useTranslation } from 'react-i18next';

/** Rendered by PRDEditor inside the prd-editor module while an existing PRD's contents are still loading. */
export default function PrdEditorLoadingState() {
  const { t } = useTranslation('tasks');
  return (
    <div className="fixed inset-0 z-[200] md:flex md:items-center md:justify-center md:bg-black/50">
      <div role="status" className="flex h-full w-full items-center justify-center bg-background p-8 md:h-auto md:w-auto md:rounded-xl">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
          <span className="text-foreground">{t('prdEditor.loading')}</span>
        </div>
      </div>
    </div>
  );
}
