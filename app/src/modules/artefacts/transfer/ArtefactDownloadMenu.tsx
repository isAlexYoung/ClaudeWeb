import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';

import { ScheduledTaskMenu, ScheduledTaskMenuItem, ScheduledTaskSubmenu } from '@/modules/scheduled-tasks';
import { EXPORT_FORMATS, exportArtefact } from '@/modules/artefacts/transfer/artefactTransfer';
import type { ExportFormat, TransferKind } from '@/modules/artefacts/transfer/artefactTransfer';

type DownloadOptions = {
  kind: TransferKind;
  title: string;
  /** What to save: the editor's current content, or the file read for the conversation card. */
  getContent: () => unknown | Promise<unknown>;
  /** The worksheet a CSV holds (the one on screen in the editor). */
  getSheetIndex?: () => number | undefined;
  onError: (message: string) => void;
};

function useDownload({ kind, title, getContent, getSheetIndex, onError }: DownloadOptions) {
  const { t } = useTranslation('sidebar');
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const run = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(format);
    try {
      await exportArtefact({ kind, title, content: await getContent() }, format, { sheetIndex: getSheetIndex?.() });
    } catch (caught) {
      onError(t('artefacts.download.failed', { error: caught instanceof Error ? caught.message : String(caught) }));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** The editor title menu's "Download" submenu, listing every format of the kind. */
export function ArtefactDownloadSubmenu({ close, ...options }: DownloadOptions & { close: () => void }) {
  const { t } = useTranslation('sidebar');
  const { run } = useDownload(options);
  return (
    <ScheduledTaskSubmenu label={t('artefacts.download.label')}>
      {EXPORT_FORMATS[options.kind].map((format) => (
        <ScheduledTaskMenuItem
          key={format}
          label={t(`artefacts.download.formats.${format}`)}
          onSelect={() => { close(); void run(format); }}
        />
      ))}
    </ScheduledTaskSubmenu>
  );
}

/** The conversation card's download button: a menu of the kind's formats. */
export function ArtefactDownloadButton({ className, iconSize, tabIndex, ...options }: DownloadOptions & {
  className: string;
  iconSize: number;
  tabIndex?: number;
}) {
  const { t } = useTranslation('sidebar');
  const { busy, run } = useDownload(options);
  return (
    <ScheduledTaskMenu
      triggerClassName={className}
      ariaLabel={t('artefacts.download.label')}
      title={t('artefacts.download.label')}
      align="end"
      trigger={busy ? <Loader2 size={iconSize} className="animate-spin" /> : <Download size={iconSize} />}
      triggerTabIndex={tabIndex}
    >
      {(close) => EXPORT_FORMATS[options.kind].map((format) => (
        <ScheduledTaskMenuItem
          key={format}
          label={t(`artefacts.download.formats.${format}`)}
          onSelect={() => { close(); void run(format); }}
        />
      ))}
    </ScheduledTaskMenu>
  );
}
