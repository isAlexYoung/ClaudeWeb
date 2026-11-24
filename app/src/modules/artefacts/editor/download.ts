import type { ArtefactDetail, SheetDocument, WhiteboardDocument } from '@/shared/types';
import { sheetToCsv } from '@/modules/artefacts/sheet/sheetFormat';

/** Saves a blob under `filename` through a temporary link. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(window.document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

/** A title made safe to use as a file name on every system. */
export function fileBaseName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim();
  return cleaned || 'Untitled';
}

/** What the artefact card's download button saves for each kind; null when nothing can be saved. */
export function artefactDownload(detail: Pick<ArtefactDetail, 'kind' | 'title' | 'content'>): { blob: Blob; filename: string } | null {
  const name = fileBaseName(detail.title);
  if (detail.kind === 'sheet') {
    const firstSheet = (detail.content as SheetDocument | null)?.sheets?.[0];
    if (!firstSheet) return null;
    // The byte order mark lets Excel read the CSV as UTF-8.
    return { blob: new Blob([`\uFEFF${sheetToCsv(firstSheet)}`], { type: 'text/csv;charset=utf-8' }), filename: `${name}.csv` };
  }
  if (detail.kind === 'doc') {
    if (typeof detail.content !== 'string') return null;
    return { blob: new Blob([detail.content], { type: 'text/markdown;charset=utf-8' }), filename: `${name}.md` };
  }
  if (detail.kind === 'whiteboard') {
    const scene = detail.content as WhiteboardDocument | null;
    if (!scene || typeof scene !== 'object') return null;
    return { blob: new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }), filename: `${name}.excalidraw` };
  }
  return null;
}
