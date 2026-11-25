import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { ArtefactDetail, ArtefactSummary } from '@/shared/types';
import { artefactKind, isEditableKind } from '@/modules/artefacts/artefactKinds';
import { ArtefactDownloadButton } from '@/modules/artefacts/transfer/ArtefactDownloadMenu';
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
 * artefact in split view; the action on the right offers its downloads (Excel
 * or CSV, Word, PDF or Markdown, PNG, SVG or .excalidraw).
 */
export default function ArtefactSessionCard({
  artefact,
  onOpen,
  variant = 'banner',
  scrollProgress = 0,
}: ArtefactSessionCardProps) {
  const { t } = useTranslation('sidebar');
  // The last failed download, shown as the button's tooltip until the next try.
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const definition = artefactKind(artefact.kind);
  const Icon = definition.icon;
  const progress = clamp01(scrollProgress);
  const downloadable = isEditableKind(artefact.kind);

  // The card has only the summary; the file is read when a format is chosen.
  const readContent = useCallback(async () => {
    setDownloadError(null);
    const detail = await readArtefactResponse<ArtefactDetail>(await api.artefacts.open(artefact.id));
    if (detail.content === null) throw new Error(detail.contentError ?? t('artefacts.download.empty'));
    return detail.content;
  }, [artefact.id, t]);

  const downloadButton = (className: string, iconSize: number, tabIndex: number | undefined) => (
    downloadable ? (
      <span className="artefact-download-slot" title={downloadError ?? undefined}>
        <ArtefactDownloadButton
          kind={artefact.kind as 'sheet' | 'doc' | 'whiteboard'}
          title={artefact.title}
          getContent={readContent}
          onError={setDownloadError}
          className={className}
          iconSize={iconSize}
          tabIndex={tabIndex}
        />
      </span>
    ) : null
  );

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
          {downloadButton('artefact-icon-button artefact-header-pill-action', 14, visible ? 0 : -1)}
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
        {downloadButton('artefact-icon-button artefact-session-card-action', 16, hidden ? -1 : undefined)}
      </div>
    </div>
  );
}
