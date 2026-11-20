import { useTranslation } from 'react-i18next';
import { UploadIcon, XIcon } from 'lucide-react';

import { formatByteSize } from '@/shared/byteSize';

type AttachmentUploadProgressRowProps = {
  progress: { loaded: number; total: number };
  onCancel?: () => void;
};

/**
 * Rendered by ChatComposer while a send uploads its files: how much has gone
 * up, and a button that stops the upload and leaves the message in the input.
 */
export default function AttachmentUploadProgressRow({ progress, onCancel }: AttachmentUploadProgressRowProps) {
  const { t } = useTranslation('chat');
  const percent = progress.total > 0 ? Math.min(100, Math.floor((progress.loaded / progress.total) * 100)) : 100;

  return (
    <div className="workspace-upload-progress flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2" role="status">
      <UploadIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{t('input.uploading')}</span>
          <span className="shrink-0 tabular-nums">
            {formatByteSize(progress.loaded)} / {formatByteSize(progress.total)} · {percent}%
          </span>
        </div>
        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-border/60"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
      </div>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <XIcon className="h-3 w-3" aria-hidden />
          {t('input.cancelUpload')}
        </button>
      )}
    </div>
  );
}
