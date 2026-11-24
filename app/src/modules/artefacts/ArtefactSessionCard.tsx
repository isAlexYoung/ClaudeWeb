import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { api } from '@/shared/api';
import type { ArtefactDetail, ArtefactSummary } from '@/shared/types';
import { artefactKind, isEditableKind } from '@/modules/artefacts/artefactKinds';
import { artefactDownload, downloadBlob } from '@/modules/artefacts/editor/download';
import { readArtefactResponse } from '@/modules/artefacts/useArtefacts';

/** The download button's label for each kind that has a file to save. */
const DOWNLOAD_LABEL_KEYS = {
  sheet: 'artefacts.editor.downloadCsv',
  doc: 'artefacts.docEditor.downloadMarkdown',
  whiteboard: 'artefacts.whiteboardEditor.downloadFile',
} as const;

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
 * artefact in split view; the action on the right downloads its file (CSV for a
 * spreadsheet, Markdown for a document, .excalidraw for a whiteboard).
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

  const downloadLabel = isEditableKind(artefact.kind) ? t(DOWNLOAD_LABEL_KEYS[artefact.kind]) : null;

  const downloadFile = async () => {
    if (downloading || !downloadLabel) return;
    setDownloading(true);
    try {
      const detail = await readArtefactResponse<ArtefactDetail>(await api.artefacts.open(artefact.id));
      const file = artefactDownload(detail);
      if (file) downloadBlob(file.blob, file.filename);
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
          {downloadLabel && (
            <button
              type="button"
              className="artefact-icon-button artefact-header-pill-action"
              aria-label={downloadLabel}
              title={downloadLabel}
              tabIndex={visible ? 0 : -1}
              disabled={downloading}
              onClick={() => void downloadFile()}
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
        {downloadLabel && (
          <button
            type="button"
            className="artefact-icon-button artefact-session-card-action"
            aria-label={downloadLabel}
            title={downloadLabel}
            tabIndex={hidden ? -1 : undefined}
            disabled={downloading}
            onClick={() => void downloadFile()}
          >
            <Download size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
