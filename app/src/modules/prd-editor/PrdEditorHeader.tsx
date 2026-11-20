import { useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  Download,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  Moon,
  Pencil,
  Save,
  Sparkles,
  Sun,
  WrapText,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';

type PrdEditorHeaderProps = {
  fileName: string;
  onFileNameChange: (nextFileName: string) => void;
  isNewFile: boolean;
  previewMode: boolean;
  onTogglePreview: () => void;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onDownload: () => void;
  onOpenGenerateTasks: () => void;
  canGenerateTasks: boolean;
  onSave: () => void;
  saving: boolean;
  saveSuccess: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
};

type HeaderIconButtonProps = {
  title: string;
  onClick: () => void;
  icon: ReactNode;
  active?: boolean;
  className?: string;
};

function HeaderIconButton({ title, onClick, icon, active = false, className }: HeaderIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        'p-2 rounded-md min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {icon}
    </button>
  );
}

/** Rendered by PrdEditorWorkspace inside the prd-editor module to hold the PRD filename field and the editor toolbar actions. */
export default function PrdEditorHeader({
  fileName,
  onFileNameChange,
  isNewFile,
  previewMode,
  onTogglePreview,
  wordWrap,
  onToggleWordWrap,
  isDarkMode,
  onToggleTheme,
  onDownload,
  onOpenGenerateTasks,
  canGenerateTasks,
  onSave,
  saving,
  saveSuccess,
  isFullscreen,
  onToggleFullscreen,
  onClose,
}: PrdEditorHeaderProps) {
  const { t } = useTranslation('tasks');
  const fileNameInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex min-w-0 flex-shrink-0 items-center justify-between border-b border-border p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-4 w-4 text-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                <input
                  ref={fileNameInputRef}
                  type="text"
                  value={fileName}
                  onChange={(event) => onFileNameChange(event.target.value)}
                  className="min-w-0 flex-1 border-none bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground sm:text-sm"
                  placeholder={t('prdEditor.fileNamePlaceholder')}
                  aria-label={t('prdEditor.fileNamePlaceholder')}
                  maxLength={100}
                />
                <span className="ml-1 whitespace-nowrap text-sm text-muted-foreground sm:text-xs">.txt</span>
              </div>

              <button
                type="button"
                onClick={() => fileNameInputRef.current?.focus()}
                className="p-1 text-muted-foreground transition-colors hover:text-foreground"
                title={t('prdEditor.focusFileName')}
                aria-label={t('prdEditor.focusFileName')}
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>

            {isNewFile && (
              <span className="flex-shrink-0 whitespace-nowrap rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {t('prdEditor.newBadge')}
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-xs text-muted-foreground sm:text-sm">{t('prdEditor.title')}</p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1 md:gap-2">
        <HeaderIconButton
          title={previewMode ? t('prdEditor.edit') : t('prdEditor.preview')}
          onClick={onTogglePreview}
          icon={<Eye className="h-5 w-5 md:h-4 md:w-4" />}
          active={previewMode}
        />

        <HeaderIconButton
          title={wordWrap ? t('prdEditor.wrapOn') : t('prdEditor.wrapOff')}
          onClick={onToggleWordWrap}
          icon={<WrapText className="h-5 w-5 md:h-4 md:w-4" />}
          active={wordWrap}
        />

        <HeaderIconButton
          title={t('prdEditor.theme')}
          onClick={onToggleTheme}
          icon={isDarkMode ? <Sun className="h-5 w-5 md:h-4 md:w-4" /> : <Moon className="h-5 w-5 md:h-4 md:w-4" />}
        />

        <HeaderIconButton
          title={t('prdEditor.download')}
          onClick={onDownload}
          icon={<Download className="h-5 w-5 md:h-4 md:w-4" />}
        />

        <button
          type="button"
          onClick={onOpenGenerateTasks}
          disabled={!canGenerateTasks}
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 md:min-h-0"
          title={t('prdEditor.generateTasksTitle')}
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden md:inline">{t('prdEditor.generateTasks')}</span>
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 md:min-h-0"
        >
          {saveSuccess ? <Check className="h-5 w-5 md:h-4 md:w-4" /> : <Save className="h-5 w-5 md:h-4 md:w-4" />}
          <span className="hidden sm:inline">
            {saveSuccess ? t('prdEditor.saved') : saving ? t('prdEditor.saving') : t('prdEditor.save')}
          </span>
        </button>

        <HeaderIconButton
          title={isFullscreen ? t('prdEditor.exitFullscreen') : t('prdEditor.fullscreen')}
          onClick={onToggleFullscreen}
          icon={isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          className="hidden md:flex"
        />

        <HeaderIconButton
          title={t('prdEditor.close')}
          onClick={onClose}
          icon={<X className="h-6 w-6 md:h-4 md:w-4" />}
        />
      </div>
    </div>
  );
}
