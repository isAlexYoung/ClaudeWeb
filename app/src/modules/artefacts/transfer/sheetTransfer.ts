import type ExcelJSNamespace from 'exceljs';

import type { SheetCellStyle, SheetCellValue, SheetData, SheetDocument } from '@/shared/types';
import { SHEET_FORMAT, columnIndex, columnLetter, formatAddress, parseAddress } from '@/modules/artefacts/sheet/sheetFormat';

/**
 * Converts spreadsheets between the `claudeweb-sheet@1` file and the formats
 * people exchange: Excel workbooks (.xlsx) and delimited text (.csv, .tsv).
 * ExcelJS is loaded only when a workbook is read or written.
 */

type ExcelJS = typeof ExcelJSNamespace;
type Worksheet = ExcelJSNamespace.Worksheet;
type Cell = ExcelJSNamespace.Cell;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel measures columns in characters of the default font, roughly 7 pixels each. */
const PIXELS_PER_CHARACTER = 7;
/** Excel measures rows in points; the grid in pixels. */
const POINTS_PER_PIXEL = 0.75;
/** Excel's own default font size; sizes equal to it are not kept as styles. */
const EXCEL_DEFAULT_FONT_SIZE = 11;
/** Day 0 of Excel's date serials (accounting for its 1900 leap-year bug). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

async function loadExcelJs(): Promise<ExcelJS> {
  const module = await import('exceljs') as unknown as { default?: ExcelJS } & ExcelJS;
  return module.default ?? module;
}

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

/** "#1a73e8" or "#abc" → "FF1A73E8"; null for anything else. */
export function cssToArgb(color: string | undefined): string | null {
  if (!color) return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split('').map((digit) => digit + digit).join('') : match[1];
  return `FF${hex.toUpperCase()}`;
}

/** "FF1A73E8" → "#1A73E8"; null for theme or indexed colours, which have no fixed value. */
export function argbToCss(argb: string | undefined): string | null {
  if (!argb || !/^[0-9a-f]{8}$/i.test(argb)) return null;
  return `#${argb.slice(2).toUpperCase()}`;
}

/**
 * The default Office theme, in the order cells refer to it (light 1 and dark 1
 * come first, swapped from the theme file's own order). A workbook with its
 * own theme comes close enough: most keep these.
 */
const OFFICE_THEME = [
  'FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31',
  'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72',
];

/** A theme colour (with its tint: negative darkens, positive lightens) as CSS hex. */
export function themeColorToCss(theme: number | undefined, tint = 0): string | null {
  if (theme === undefined || !Number.isInteger(theme)) return null;
  const base = OFFICE_THEME[theme];
  if (!base) return null;
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(base.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  if (tint < 0) lightness *= 1 + tint;
  else if (tint > 0) lightness = lightness * (1 - tint) + tint;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

type ExcelColor = { argb?: string; theme?: number; tint?: number } | undefined;

function excelColorToCss(color: ExcelColor): string | null {
  return argbToCss(color?.argb) ?? themeColorToCss(color?.theme, color?.tint ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Sheet names                                                        */
/* ------------------------------------------------------------------ */

/** Excel's sheet-name rules: at most 31 characters, none of []:*?/\, and unique in the workbook. */
function excelSheetName(name: string, taken: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);
  let candidate = base;
  for (let index = 2; taken.has(candidate.toLowerCase()); index += 1) {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/* ------------------------------------------------------------------ */
/*  Export                                                             */
/* ------------------------------------------------------------------ */

function applyStyle(cell: Cell, style: SheetCellStyle): void {
  const font: Partial<ExcelJSNamespace.Font> = {};
  if (style.bold) font.bold = true;
  if (style.italic) font.italic = true;
  if (style.underline) font.underline = true;
  const color = cssToArgb(style.color);
  if (color) font.color = { argb: color };
  if (typeof style.fontSize === 'number' && style.fontSize > 0) font.size = style.fontSize;
  if (Object.keys(font).length > 0) cell.font = font;

  const background = cssToArgb(style.bg);
  if (background) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } };

  const alignment: Partial<ExcelJSNamespace.Alignment> = {};
  if (style.align) alignment.horizontal = style.align;
  if (style.valign) alignment.vertical = style.valign;
  if (Object.keys(alignment).length > 0) cell.alignment = alignment;

  if (style.format) cell.numFmt = style.format;
}

function writeSheet(worksheet: Worksheet, sheet: SheetData): void {
  const addresses = new Set([...Object.keys(sheet.cells ?? {}), ...Object.keys(sheet.styles ?? {})]);
  for (const address of addresses) {
    if (!parseAddress(address)) continue;
    const cell = worksheet.getCell(address.toUpperCase());
    const value = sheet.cells?.[address];
    if (typeof value === 'string' && value.startsWith('=')) cell.value = { formula: value.slice(1) } as ExcelJSNamespace.CellFormulaValue;
    else if (value !== undefined && value !== null) cell.value = value;
    const style = sheet.styles?.[address];
    if (style) applyStyle(cell, style);
  }
  for (const range of sheet.merges ?? []) {
    try {
      worksheet.mergeCells(range.toUpperCase());
    } catch {
      // An overlapping or malformed range is left unmerged rather than failing the export.
    }
  }
  for (const [letters, width] of Object.entries(sheet.colWidths ?? {})) {
    if (columnIndex(letters.toUpperCase()) >= 0 && width > 0) {
      worksheet.getColumn(letters.toUpperCase()).width = Math.round((width / PIXELS_PER_CHARACTER) * 100) / 100;
    }
  }
  for (const [row, height] of Object.entries(sheet.rowHeights ?? {})) {
    const index = Number(row);
    if (Number.isInteger(index) && index > 0 && height > 0) worksheet.getRow(index).height = Math.round(height * POINTS_PER_PIXEL * 100) / 100;
  }
  const rows = Math.max(0, Math.floor(sheet.frozen?.rows ?? 0));
  const cols = Math.max(0, Math.floor(sheet.frozen?.cols ?? 0));
  if (rows > 0 || cols > 0) worksheet.views = [{ state: 'frozen', xSplit: cols, ySplit: rows }];
}

/**
 * The whole spreadsheet as an Excel workbook, one worksheet per sheet.
 * Formulas are written without cached results and the workbook asks to be
 * recalculated when it opens, so Excel, WPS and LibreOffice show the values.
 */
export async function sheetDocumentToXlsx(document: SheetDocument): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ClaudeWeb';
  workbook.calcProperties.fullCalcOnLoad = true;
  const taken = new Set<string>();
  const sheets = document.sheets.length > 0 ? document.sheets : [{ name: 'Sheet1', cells: {} }];
  for (const sheet of sheets) writeSheet(workbook.addWorksheet(excelSheetName(sheet.name, taken)), sheet);
  return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */

/** What a workbook held that a spreadsheet artefact cannot keep. */
export type SheetImportWarning = 'images' | 'conditionalFormatting' | 'dataValidation' | 'comments';

function dateToSerial(date: Date): number {
  return Math.round(((date.getTime() - EXCEL_EPOCH_MS) / MS_PER_DAY) * 1e8) / 1e8;
}

function richText(value: unknown): string | null {
  const runs = (value as { richText?: Array<{ text?: string }> } | null)?.richText;
  return Array.isArray(runs) ? runs.map((run) => run.text ?? '').join('') : null;
}

/** The cell's value in the artefact's terms, and whether it is a date needing a date format. */
function readValue(cell: Cell): { value: SheetCellValue | undefined; isDate: boolean } {
  const formula = (cell as unknown as { formula?: string }).formula;
  if (typeof formula === 'string' && formula.trim()) return { value: `=${formula.replace(/^=/, '')}`, isDate: false };
  const raw = cell.value as unknown;
  if (raw === null || raw === undefined || raw === '') return { value: undefined, isDate: false };
  if (typeof raw === 'number' || typeof raw === 'boolean') return { value: raw, isDate: false };
  if (typeof raw === 'string') return { value: raw, isDate: false };
  if (raw instanceof Date) return { value: dateToSerial(raw), isDate: true };
  if (typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    const text = richText(raw);
    if (text !== null) return { value: text === '' ? undefined : text, isDate: false };
    // A hyperlink keeps its shown text, which may itself be rich text.
    if ('hyperlink' in object) {
      const shown = typeof object.text === 'string' ? object.text : richText(object.text) ?? String(object.hyperlink ?? '');
      return { value: shown || undefined, isDate: false };
    }
    if (typeof object.error === 'string') return { value: object.error, isDate: false };
    // A formula whose text ExcelJS could not give back keeps its last result.
    if ('result' in object) {
      const result = object.result;
      if (result instanceof Date) return { value: dateToSerial(result), isDate: true };
      if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean') return { value: result, isDate: false };
    }
  }
  return { value: undefined, isDate: false };
}

function readStyle(cell: Cell, isDate: boolean): SheetCellStyle | undefined {
  const style: SheetCellStyle = {};
  const font = cell.font;
  if (font?.bold) style.bold = true;
  if (font?.italic) style.italic = true;
  if (font?.underline && font.underline !== 'none') style.underline = true;
  const color = excelColorToCss(font?.color as ExcelColor);
  if (color && color !== '#000000') style.color = color;
  if (typeof font?.size === 'number' && font.size !== EXCEL_DEFAULT_FONT_SIZE) style.fontSize = font.size;

  const fill = cell.fill as ExcelJSNamespace.FillPattern | undefined;
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const background = excelColorToCss(fill.fgColor as ExcelColor);
    if (background && background !== '#FFFFFF') style.bg = background;
  }

  const horizontal = cell.alignment?.horizontal;
  if (horizontal === 'left' || horizontal === 'center' || horizontal === 'right') style.align = horizontal;
  const vertical = cell.alignment?.vertical;
  if (vertical === 'top' || vertical === 'middle' || vertical === 'bottom') style.valign = vertical;

  const format = cell.numFmt;
  // Excel's built-in short date ("mm-dd-yy", format 14) shows in each reader's own date order; the grid has no such format.
  if (isDate && (!format || format === 'General' || format === 'mm-dd-yy')) style.format = 'yyyy-mm-dd';
  else if (format && format !== 'General') style.format = format;
  return Object.keys(style).length > 0 ? style : undefined;
}

function readSheet(worksheet: Worksheet, warnings: Set<SheetImportWarning>): SheetData {
  const cells: Record<string, SheetCellValue> = {};
  const styles: Record<string, SheetCellStyle> = {};
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      // A cell covered by a merge belongs to the merge's top-left cell.
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      const address = formatAddress(Number(cell.row) - 1, Number(cell.col) - 1);
      const { value, isDate } = readValue(cell);
      if (value !== undefined) cells[address] = value;
      const style = readStyle(cell, isDate);
      if (style) styles[address] = style;
      if (cell.note) warnings.add('comments');
    });
  });

  const merges = [...new Set((worksheet.model as { merges?: string[] }).merges ?? [])];

  const colWidths: Record<string, number> = {};
  const columnCount = worksheet.columnCount;
  for (let index = 1; index <= columnCount; index += 1) {
    const column = worksheet.getColumn(index);
    if (typeof column.width === 'number' && column.width > 0) colWidths[columnLetter(index - 1)] = Math.round(column.width * PIXELS_PER_CHARACTER);
  }
  const rowHeights: Record<string, number> = {};
  worksheet.eachRow({ includeEmpty: true }, (row, number) => {
    if (typeof row.height === 'number' && row.height > 0) rowHeights[String(number)] = Math.round(row.height / POINTS_PER_PIXEL);
  });

  const view = worksheet.views?.find((candidate) => candidate.state === 'frozen') as { xSplit?: number; ySplit?: number } | undefined;
  const frozen = view && ((view.ySplit ?? 0) > 0 || (view.xSplit ?? 0) > 0)
    ? { rows: Math.max(0, Math.floor(view.ySplit ?? 0)), cols: Math.max(0, Math.floor(view.xSplit ?? 0)) }
    : undefined;

  const model = worksheet as unknown as {
    getImages?: () => unknown[];
    conditionalFormattings?: unknown[];
    dataValidations?: { model?: Record<string, unknown> };
  };
  if ((model.getImages?.() ?? []).length > 0) warnings.add('images');
  if ((model.conditionalFormattings ?? []).length > 0) warnings.add('conditionalFormatting');
  if (Object.keys(model.dataValidations?.model ?? {}).length > 0) warnings.add('dataValidation');

  return {
    name: worksheet.name,
    cells,
    ...(Object.keys(styles).length > 0 ? { styles } : {}),
    ...(merges.length > 0 ? { merges } : {}),
    ...(Object.keys(colWidths).length > 0 ? { colWidths } : {}),
    ...(Object.keys(rowHeights).length > 0 ? { rowHeights } : {}),
    ...(frozen ? { frozen } : {}),
  };
}

/** An Excel workbook as a spreadsheet artefact, with what it held that was left out. */
export async function xlsxToSheetDocument(data: ArrayBuffer): Promise<{ document: SheetDocument; warnings: SheetImportWarning[] }> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const warnings = new Set<SheetImportWarning>();
  const sheets: SheetData[] = [];
  workbook.eachSheet((worksheet) => sheets.push(readSheet(worksheet, warnings)));
  if (sheets.length === 0) sheets.push({ name: 'Sheet1', cells: {} });
  return { document: { format: SHEET_FORMAT, sheets }, warnings: [...warnings] };
}

/* ------------------------------------------------------------------ */
/*  Delimited text                                                     */
/* ------------------------------------------------------------------ */

/** RFC 4180 rows: quoted fields may hold delimiters, quotes ("") and line breaks. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  const source = text.replace(/^﻿/, '');
  while (index < source.length) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else {
        field += character;
      }
      index += 1;
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (character === '\r' && source[index + 1] === '\n') index += 1;
    } else {
      field += character;
    }
    index += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The delimiter a file uses: the one of tab, semicolon and comma that splits its first lines most evenly. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r\n|\n|\r/).filter((line) => line.trim()).slice(0, 10).join('\n');
  let best = ',';
  let bestScore = 0;
  for (const delimiter of ['\t', ';', ',']) {
    const counts = parseDelimited(sample, delimiter).map((fields) => fields.length);
    if (counts.length === 0) continue;
    const first = counts[0];
    // Every sampled line splitting into the same number of fields (more than one) is a strong signal.
    const consistent = counts.every((count) => count === first);
    const score = first > 1 ? first * (consistent ? 2 : 1) : 0;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** A field's value: numbers stay numbers (without turning codes such as "007" into 7), TRUE/FALSE booleans. */
function delimitedValue(text: string): SheetCellValue | undefined {
  if (text === '') return undefined;
  const trimmed = text.trim();
  if (/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(trimmed)) return Number(trimmed);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  return text;
}

/** A .csv or .tsv file as a one-sheet spreadsheet. */
export function delimitedToSheetDocument(text: string, name: string, delimiter = detectDelimiter(text)): SheetDocument {
  const cells: Record<string, SheetCellValue> = {};
  parseDelimited(text, delimiter).forEach((fields, r) => {
    fields.forEach((field, c) => {
      const value = delimitedValue(field);
      if (value !== undefined) cells[formatAddress(r, c)] = value;
    });
  });
  return { format: SHEET_FORMAT, sheets: [{ name: (name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet1').slice(0, 31), cells }] };
}
