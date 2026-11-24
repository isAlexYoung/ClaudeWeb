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
  /** Full banner at the top of the transcript or compact pill docked into the header bar. */
  variant?: 'banner' | 'header';
  /** Normalized scroll progress (0 = top of transcript, 1 = scrolled into header). */
  scrollProgress?: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Shown at the top of an artefact's own Chat conversation (and smoothly docked
 * into the workspace header bar as the user scrolls down). Clicking opens the
 * spreadsheet in split view; the action on the right downloads CSV.
 */
export default function ArtefactSessionCard({
  artefact,
  onOpen,
  variant = 'banner',
  scrollProgress = 0,
}: ArtefactSessionCardProps) {
  const { t } = useTranslation('sidebar');
  const [downloading, setDownloading] = useState(false);
  const definition = artefactKind(artefact.kind);
  const Icon = definition.icon;
  const progress = clamp01(scrollProgress);

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

  if (variant === 'header') {
    const headerProgress = clamp01((progress - 0.18) / 0.82);
    const visible = headerProgress > 0.12;
    return (
      <div
        className="artefact-header-dock"
        data-visible={visible ? 'true' : 'false'}
        aria-hidden={!visible || undefined}
        style={{
          opacity: headerProgress,
          transform: `translateY(${((1 - headerProgress) * 10).toFixed(2)}px) scale(${(0.94 + headerProgress * 0.06).toFixed(3)})`,
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        <div className={`artefact-header-pill artefact-kind-${definition.kind}`}>
          <button
            type="button"
            className="artefact-header-pill-open"
            tabIndex={visible ? 0 : -1}
            onClick={() => onOpen(artefact.id)}
          >
            <span className="artefact-header-pill-icon" aria-hidden="true">
              <Icon size={15} strokeWidth={1.9} />
            </span>
            <span className="artefact-header-pill-text">
              <strong>{artefact.title}</strong>
              <small>{t(`artefacts.kinds.${artefact.kind}`)}</small>
            </span>
          </button>
          {artefact.kind === 'sheet' && (
            <button
              type="button"
              className="artefact-icon-button artefact-header-pill-action"
              aria-label={t('artefacts.editor.downloadCsv')}
              title={t('artefacts.editor.downloadCsv')}
              tabIndex={visible ? 0 : -1}
              disabled={downloading}
              onClick={() => void downloadCsv()}
            >
              <Download size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  const hidden = progress > 0.85;
  const bannerStyle = progress > 0
    ? {
        opacity: Number((1 - progress).toFixed(3)),
        transform: `translateY(${(-progress * 12).toFixed(2)}px) scale(${(1 - progress * 0.035).toFixed(3)})`,
        pointerEvents: hidden ? ('none' as const) : undefined,
      }
    : undefined;

  return (
    <div
      className="artefact-session-banner"
      data-collapsed={hidden ? 'true' : 'false'}
      aria-hidden={hidden || undefined}
      style={bannerStyle}
    >
      <div className={`artefact-session-card artefact-kind-${definition.kind}`}>
        <button
          type="button"
          className="artefact-session-card-open"
          tabIndex={hidden ? -1 : undefined}
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
            tabIndex={hidden ? -1 : undefined}
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
