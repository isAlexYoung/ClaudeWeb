import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { api } from '@/shared/api';
import type { ArtefactDetail, ArtefactSummary } from '@/shared/types';
import { artefactKind } from '@/modules/artefacts/artefactKinds';
import { sheetToCsv } from '@/modules/artefacts/sheet/sheetFormat';
import { readArtefactResponse } from '@/modules/artefacts/useArtefacts';

type ArtefactSessionCardProps = {
  artefact: ArtefactSummary;
  onOpen: (artefactId: string) => void;
};

/**
 * Shown at the top of an artefact's own Chat conversation (when minimized from
 * the editor or opened from the sidebar). Clicking the card restores the full
 * spreadsheet editor; the action on the right downloads the first sheet as CSV.
 */
export default function ArtefactSessionCard({ artefact, onOpen }: ArtefactSessionCardProps) {
  const { t } = useTranslation('sidebar');
  const [downloading, setDownloading] = useState(false);
  const definition = artefactKind(artefact.kind);
  const Icon = definition.icon;

  const downloadCsv = async () => {
    if (downloading || artefact.kind !== 'sheet') return;
    setDownloading(true);
    try {
      const detail = await readArtefactResponse<ArtefactDetail>(await api.artefacts.open(artefact.id));
      const firstSheet = detail.content?.sheets?.[0];
      if (!firstSheet) return;
      const blob = new Blob([`\uFEFF${sheetToCsv(firstSheet)}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(window.document.createElement('a'), { href: url, download: `${detail.title}.csv` });
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="artefact-session-banner">
      <div className={`artefact-session-card artefact-kind-${definition.kind}`}>
        <button
          type="button"
          className="artefact-session-card-open"
          onClick={() => onOpen(artefact.id)}
        >
          <span className="artefact-session-card-icon" aria-hidden="true">
            <Icon size={20} strokeWidth={1.9} />
          </span>
          <span className="artefact-session-card-text">
            <strong>{artefact.title}</strong>
            <small>{t(`artefacts.kinds.${artefact.kind}`)}</small>
          </span>
        </button>
        {artefact.kind === 'sheet' && (
          <button
            type="button"
            className="artefact-icon-button artefact-session-card-action"
            aria-label={t('artefacts.editor.downloadCsv')}
            title={t('artefacts.editor.downloadCsv')}
            disabled={downloading}
            onClick={() => void downloadCsv()}
          >
            <Download size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
