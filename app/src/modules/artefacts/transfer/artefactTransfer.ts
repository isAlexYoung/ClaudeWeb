import type { SheetDocument, WhiteboardDocument } from '@/shared/types';
import { sheetToCsv } from '@/modules/artefacts/sheet/sheetFormat';
import { downloadBlob, fileBaseName } from '@/modules/artefacts/editor/download';

/**
 * What every artefact can be saved as and read from, and the one place that
 * does it: the download menus (editor title menus, the conversation card) and
 * the Artefacts page's import call these. The converters behind them load
 * their libraries only when used.
 */

export type TransferKind = 'sheet' | 'doc' | 'whiteboard';
export type ExportFormat = 'xlsx' | 'csv' | 'docx' | 'pdf' | 'md' | 'png' | 'svg' | 'excalidraw';

/** The download menu of each kind, the most useful format first. */
export const EXPORT_FORMATS: Record<TransferKind, ExportFormat[]> = {
  sheet: ['xlsx', 'csv'],
  doc: ['docx', 'pdf', 'md'],
  whiteboard: ['png', 'svg', 'excalidraw'],
};

/** The largest file the server keeps for each kind (sheet-format.ts, doc-format.ts, whiteboard-format.ts). */
export const MAX_IMPORT_BYTES: Record<TransferKind, number> = {
  sheet: 5 * 1024 * 1024,
  doc: 2 * 1024 * 1024,
  whiteboard: 10 * 1024 * 1024,
};

export type ExportSource = {
  kind: TransferKind;
  title: string;
  content: unknown;
};

function isSheetDocument(content: unknown): content is SheetDocument {
  return Boolean(content && typeof content === 'object' && Array.isArray((content as SheetDocument).sheets));
}

function isWhiteboardDocument(content: unknown): content is WhiteboardDocument {
  return Boolean(content && typeof content === 'object' && (content as WhiteboardDocument).type === 'excalidraw');
}

/**
 * Saves the artefact in `format` (the browser's download), or for PDF opens
 * the print dialog. `sheetIndex` picks the worksheet a CSV holds.
 */
export async function exportArtefact(source: ExportSource, format: ExportFormat, options: { sheetIndex?: number } = {}): Promise<void> {
  const name = fileBaseName(source.title);
  if (source.kind === 'sheet') {
    if (!isSheetDocument(source.content)) throw new Error('The spreadsheet has no content.');
    if (format === 'xlsx') {
      const { sheetDocumentToXlsx, XLSX_MIME } = await import('@/modules/artefacts/transfer/sheetTransfer');
      downloadBlob(new Blob([await sheetDocumentToXlsx(source.content)], { type: XLSX_MIME }), `${name}.xlsx`);
      return;
    }
    if (format === 'csv') {
      const sheets = source.content.sheets;
      const sheet = sheets[Math.min(Math.max(options.sheetIndex ?? 0, 0), Math.max(sheets.length - 1, 0))];
      if (!sheet) throw new Error('The spreadsheet has no sheets.');
      // The byte order mark lets Excel read the CSV as UTF-8.
      const suffix = sheets.length > 1 ? ` - ${fileBaseName(sheet.name)}` : '';
      downloadBlob(new Blob([`﻿${sheetToCsv(sheet)}`], { type: 'text/csv;charset=utf-8' }), `${name}${suffix}.csv`);
      return;
    }
  }
  if (source.kind === 'doc') {
    if (typeof source.content !== 'string') throw new Error('The document has no content.');
    if (format === 'md') {
      downloadBlob(new Blob([source.content], { type: 'text/markdown;charset=utf-8' }), `${name}.md`);
      return;
    }
    if (format === 'docx') {
      const { markdownToDocx } = await import('@/modules/artefacts/transfer/docTransfer');
      downloadBlob(await markdownToDocx(source.content, source.title), `${name}.docx`);
      return;
    }
    if (format === 'pdf') {
      const { printMarkdown } = await import('@/modules/artefacts/transfer/docTransfer');
      await printMarkdown(source.content, name);
      return;
    }
  }
  if (source.kind === 'whiteboard') {
    if (!isWhiteboardDocument(source.content)) throw new Error('The whiteboard has no content.');
    if (format === 'excalidraw') {
      downloadBlob(new Blob([JSON.stringify(source.content, null, 2)], { type: 'application/json' }), `${name}.excalidraw`);
      return;
    }
    if (format === 'png') {
      const { whiteboardToPng } = await import('@/modules/artefacts/transfer/whiteboardTransfer');
      downloadBlob(await whiteboardToPng(source.content), `${name}.png`);
      return;
    }
    if (format === 'svg') {
      const { whiteboardToSvg } = await import('@/modules/artefacts/transfer/whiteboardTransfer');
      downloadBlob(await whiteboardToSvg(source.content), `${name}.svg`);
      return;
    }
  }
  throw new Error(`Cannot save a ${source.kind} as ${format}.`);
}

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */

/** What the file picker offers. */
export const IMPORT_ACCEPT = '.xlsx,.csv,.tsv,.md,.markdown,.txt,.docx,.excalidraw,.json';

/** Something a file held that its artefact cannot keep; named in the import notice. */
export type ImportWarning = 'images' | 'conditionalFormatting' | 'dataValidation' | 'comments' | 'docImages';

export type ImportedArtefact = {
  kind: TransferKind;
  title: string;
  content: unknown;
  warnings: ImportWarning[];
};

export type ImportErrorCode = 'unsupported' | 'legacy' | 'invalid' | 'tooLarge';

export class ArtefactImportError extends Error {
  constructor(readonly code: ImportErrorCode, readonly limitBytes?: number) {
    super(code);
    this.name = 'ArtefactImportError';
  }
}

const KIND_BY_EXTENSION: Record<string, TransferKind> = {
  xlsx: 'sheet',
  csv: 'sheet',
  tsv: 'sheet',
  md: 'doc',
  markdown: 'doc',
  txt: 'doc',
  docx: 'doc',
  excalidraw: 'whiteboard',
  json: 'whiteboard',
};

function splitName(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { base: fileName, extension: '' };
  return { base: fileName.slice(0, dot), extension: fileName.slice(dot + 1).toLowerCase() };
}

/** The kind a file becomes, or null when it cannot be imported. */
export function importKindOf(fileName: string): TransferKind | null {
  return KIND_BY_EXTENSION[splitName(fileName).extension] ?? null;
}

const encoder = new TextEncoder();

function checkSize(kind: TransferKind, text: string): void {
  if (encoder.encode(text).length > MAX_IMPORT_BYTES[kind]) throw new ArtefactImportError('tooLarge', MAX_IMPORT_BYTES[kind]);
}

/** Text as UTF-8 (falling back to GBK, which many Chinese CSV files still use). */
async function readText(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
    }
  }
}

/** Reads a file into the artefact it becomes; throws ArtefactImportError when it cannot. */
export async function readImportFile(file: File): Promise<ImportedArtefact> {
  const { base, extension } = splitName(file.name);
  const title = (base.trim() || file.name).slice(0, 120);
  if (extension === 'xls' || extension === 'doc') throw new ArtefactImportError('legacy');
  const kind = KIND_BY_EXTENSION[extension];
  if (!kind) throw new ArtefactImportError('unsupported');

  if (extension === 'xlsx') {
    const { xlsxToSheetDocument } = await import('@/modules/artefacts/transfer/sheetTransfer');
    let result: Awaited<ReturnType<typeof xlsxToSheetDocument>>;
    try {
      result = await xlsxToSheetDocument(await file.arrayBuffer());
    } catch {
      throw new ArtefactImportError('invalid');
    }
    checkSize('sheet', JSON.stringify(result.document, null, 2));
    return { kind, title, content: result.document, warnings: result.warnings };
  }
  if (extension === 'csv' || extension === 'tsv') {
    const { delimitedToSheetDocument } = await import('@/modules/artefacts/transfer/sheetTransfer');
    const text = await readText(file);
    const document = delimitedToSheetDocument(text, title, extension === 'tsv' ? '\t' : undefined);
    checkSize('sheet', JSON.stringify(document, null, 2));
    return { kind, title, content: document, warnings: [] };
  }
  if (extension === 'docx') {
    const { docxToMarkdown } = await import('@/modules/artefacts/transfer/docTransfer');
    let result: Awaited<ReturnType<typeof docxToMarkdown>>;
    try {
      result = await docxToMarkdown(await file.arrayBuffer());
    } catch {
      throw new ArtefactImportError('invalid');
    }
    checkSize('doc', result.markdown);
    return { kind, title, content: result.markdown, warnings: result.droppedImages ? ['docImages'] : [] };
  }
  if (kind === 'doc') {
    const markdown = await readText(file);
    checkSize('doc', markdown);
    return { kind, title, content: markdown, warnings: [] };
  }
  const { parseWhiteboardFile } = await import('@/modules/artefacts/transfer/whiteboardTransfer');
  const text = await readText(file);
  const scene = parseWhiteboardFile(text);
  if (!scene) throw new ArtefactImportError(extension === 'json' ? 'unsupported' : 'invalid');
  checkSize('whiteboard', JSON.stringify(scene, null, 2));
  return { kind, title, content: scene, warnings: [] };
}
