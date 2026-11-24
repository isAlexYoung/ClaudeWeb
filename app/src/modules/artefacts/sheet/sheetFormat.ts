import type { SheetCellStyle, SheetCellValue, SheetData, SheetDocument } from '@/shared/types';

/**
 * Converts between the `claudeweb-sheet@1` file (A1-keyed, what Claude edits)
 * and FortuneSheet's workbook data (row/column cells, what the grid renders).
 * Only what both sides understand survives a round trip: values, formulas,
 * the styles in SheetCellStyle, merges, column widths, row heights and
 * frozen panes.
 */

export const SHEET_FORMAT = 'claudeweb-sheet@1';

/** The subset of a FortuneSheet cell this converter reads and writes. */
export type GridCell = {
  v?: string | number | boolean | null;
  m?: string | number;
  f?: string;
  ct?: { fa?: string; t?: string; s?: Array<{ v?: string }> };
  mc?: { r: number; c: number; rs?: number; cs?: number };
  bl?: number;
  it?: number;
  un?: number;
  fc?: string;
  bg?: string | null;
  ht?: number;
  vt?: number;
  fs?: number;
};

/** The subset of a FortuneSheet sheet this converter reads and writes. */
export type GridSheet = {
  name: string;
  id?: string;
  order?: number;
  row?: number;
  column?: number;
  celldata?: Array<{ r: number; c: number; v: GridCell | null }>;
  data?: Array<Array<GridCell | null>>;
  config?: {
    merge?: Record<string, { r: number; c: number; rs: number; cs: number }>;
    columnlen?: Record<string, number>;
    rowlen?: Record<string, number>;
    [key: string]: unknown;
  };
  frozen?: { type: string; range?: { row_focus: number; column_focus: number } };
  [key: string]: unknown;
};

const MIN_ROWS = 100;
const MIN_COLUMNS = 26;
const DEFAULT_FORMAT = 'General';
const DEFAULT_TEXT_COLOR = '#000000';

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(index: number): string {
  let letters = '';
  let remaining = index + 1;
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** "A" → 0, "AA" → 26; -1 for anything that is not a column. */
export function columnIndex(letters: string): number {
  if (!/^[A-Z]{1,3}$/.test(letters)) return -1;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** "B3" → { r: 2, c: 1 }; null for anything that is not an A1 address. */
export function parseAddress(address: string): { r: number; c: number } | null {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(address.trim().toUpperCase());
  if (!match) return null;
  return { r: Number(match[2]) - 1, c: columnIndex(match[1]) };
}

export function formatAddress(r: number, c: number): string {
  return `${columnLetter(c)}${r + 1}`;
}

const ALIGN_TO_GRID: Record<NonNullable<SheetCellStyle['align']>, number> = { center: 0, left: 1, right: 2 };
const VALIGN_TO_GRID: Record<NonNullable<SheetCellStyle['valign']>, number> = { middle: 0, top: 1, bottom: 2 };
const GRID_TO_ALIGN: Record<number, SheetCellStyle['align']> = { 0: 'center', 1: 'left', 2: 'right' };
const GRID_TO_VALIGN: Record<number, SheetCellStyle['valign']> = { 0: 'middle', 1: 'top', 2: 'bottom' };

function gridCell(value: SheetCellValue | undefined, style: SheetCellStyle | undefined): GridCell | null {
  const cell: GridCell = {};
  if (typeof value === 'string' && value.startsWith('=')) {
    // FortuneSheet computes the value when the workbook loads (forceCalculation).
    cell.f = value;
    cell.ct = { fa: style?.format ?? DEFAULT_FORMAT, t: 'n' };
  } else if (typeof value === 'number') {
    cell.v = value;
    cell.m = String(value);
    cell.ct = { fa: style?.format ?? DEFAULT_FORMAT, t: 'n' };
  } else if (typeof value === 'boolean') {
    cell.v = value;
    cell.m = value ? 'TRUE' : 'FALSE';
    cell.ct = { fa: DEFAULT_FORMAT, t: 'b' };
  } else if (typeof value === 'string') {
    cell.v = value;
    cell.m = value;
    cell.ct = { fa: style?.format ?? DEFAULT_FORMAT, t: 'g' };
  } else if (style?.format) {
    cell.ct = { fa: style.format, t: 'n' };
  }
  if (style?.bold) cell.bl = 1;
  if (style?.italic) cell.it = 1;
  if (style?.underline) cell.un = 1;
  if (style?.color) cell.fc = style.color;
  if (style?.bg) cell.bg = style.bg;
  if (style?.align && style.align in ALIGN_TO_GRID) cell.ht = ALIGN_TO_GRID[style.align];
  // Numbers line up on the right, as in other spreadsheets; FortuneSheet would put them left.
  else if (isNumeric(value)) cell.ht = ALIGN_TO_GRID.right;
  if (style?.valign && style.valign in VALIGN_TO_GRID) cell.vt = VALIGN_TO_GRID[style.valign];
  if (typeof style?.fontSize === 'number') cell.fs = style.fontSize;
  return Object.keys(cell).length > 0 ? cell : null;
}

/** Numbers and formulas (which nearly always compute to numbers) align right by default. */
function isNumeric(value: SheetCellValue | undefined): boolean {
  return typeof value === 'number' || (typeof value === 'string' && value.startsWith('='));
}

function parseRange(range: string): { r: number; c: number; rs: number; cs: number } | null {
  const [from, to] = range.split(':');
  const start = from ? parseAddress(from) : null;
  const end = to ? parseAddress(to) : start;
  if (!start || !end) return null;
  const r = Math.min(start.r, end.r);
  const c = Math.min(start.c, end.c);
  return { r, c, rs: Math.abs(end.r - start.r) + 1, cs: Math.abs(end.c - start.c) + 1 };
}

/** The workbook FortuneSheet renders for a file. Sheet ids are stable per position. */
export function toGridSheets(document: SheetDocument): GridSheet[] {
  return document.sheets.map((sheet, order) => {
    const cells = new Map<string, GridCell>();
    let maxRow = 0;
    let maxColumn = 0;
    const addresses = new Set([...Object.keys(sheet.cells ?? {}), ...Object.keys(sheet.styles ?? {})]);
    for (const address of addresses) {
      const position = parseAddress(address);
      if (!position) continue;
      const cell = gridCell(sheet.cells?.[address], sheet.styles?.[address]);
      if (!cell) continue;
      cells.set(`${position.r}_${position.c}`, cell);
      maxRow = Math.max(maxRow, position.r);
      maxColumn = Math.max(maxColumn, position.c);
    }

    const merge: Record<string, { r: number; c: number; rs: number; cs: number }> = {};
    for (const range of sheet.merges ?? []) {
      const parsed = parseRange(range);
      if (!parsed || (parsed.rs === 1 && parsed.cs === 1)) continue;
      merge[`${parsed.r}_${parsed.c}`] = parsed;
      for (let r = parsed.r; r < parsed.r + parsed.rs; r += 1) {
        for (let c = parsed.c; c < parsed.c + parsed.cs; c += 1) {
          const key = `${r}_${c}`;
          const existing = cells.get(key) ?? {};
          cells.set(key, { ...existing, mc: r === parsed.r && c === parsed.c ? { ...parsed } : { r: parsed.r, c: parsed.c } });
        }
      }
      maxRow = Math.max(maxRow, parsed.r + parsed.rs - 1);
      maxColumn = Math.max(maxColumn, parsed.c + parsed.cs - 1);
    }

    const columnlen: Record<string, number> = {};
    for (const [letters, width] of Object.entries(sheet.colWidths ?? {})) {
      const index = columnIndex(letters.toUpperCase());
      if (index >= 0 && Number.isFinite(width) && width > 0) columnlen[String(index)] = width;
    }
    const rowlen: Record<string, number> = {};
    for (const [row, height] of Object.entries(sheet.rowHeights ?? {})) {
      const index = Number(row) - 1;
      if (Number.isInteger(index) && index >= 0 && Number.isFinite(height) && height > 0) rowlen[String(index)] = height;
    }

    const frozenRows = Math.max(0, Math.floor(sheet.frozen?.rows ?? 0));
    const frozenColumns = Math.max(0, Math.floor(sheet.frozen?.cols ?? 0));
    const frozen = frozenRows > 0 && frozenColumns > 0
      ? { type: 'rangeBoth', range: { row_focus: frozenRows - 1, column_focus: frozenColumns - 1 } }
      : frozenRows > 0
        ? { type: 'rangeRow', range: { row_focus: frozenRows - 1, column_focus: 0 } }
        : frozenColumns > 0
          ? { type: 'rangeColumn', range: { row_focus: 0, column_focus: frozenColumns - 1 } }
          : undefined;

    return {
      name: sheet.name,
      id: `sheet-${order + 1}`,
      order,
      status: order === 0 ? 1 : 0,
      row: Math.max(MIN_ROWS, maxRow + 20),
      column: Math.max(MIN_COLUMNS, maxColumn + 5),
      // Initialise an explicit A1 selection so FortuneSheet's name box renders "A1" instead of "A1:NaN".
      luckysheet_select_save: [{ row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 }],
      celldata: [...cells.entries()].map(([key, v]) => {
        const [r, c] = key.split('_').map(Number);
        return { r, c, v };
      }),
      config: {
        ...(Object.keys(merge).length > 0 ? { merge } : {}),
        ...(Object.keys(columnlen).length > 0 ? { columnlen } : {}),
        ...(Object.keys(rowlen).length > 0 ? { rowlen } : {}),
      },
      ...(frozen ? { frozen } : {}),
    };
  });
}

function readCellValue(cell: GridCell): SheetCellValue | undefined {
  if (typeof cell.f === 'string' && cell.f.trim()) return cell.f.startsWith('=') ? cell.f : `=${cell.f}`;
  // Rich text keeps its runs in ct.s and no plain value.
  if (cell.ct?.t === 'inlineStr' && Array.isArray(cell.ct.s)) {
    const text = cell.ct.s.map((run) => run.v ?? '').join('');
    return text === '' ? undefined : text;
  }
  const value = cell.v;
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  // A typed number arrives as a numeric string with a numeric cell type.
  if (cell.ct?.t === 'n' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function readCellStyle(cell: GridCell): SheetCellStyle | undefined {
  const style: SheetCellStyle = {};
  if (cell.bl === 1) style.bold = true;
  if (cell.it === 1) style.italic = true;
  if (cell.un === 1) style.underline = true;
  if (cell.fc && cell.fc.toLowerCase() !== DEFAULT_TEXT_COLOR) style.color = cell.fc;
  if (cell.bg) style.bg = cell.bg;
  if (typeof cell.ht === 'number' && GRID_TO_ALIGN[cell.ht]) style.align = GRID_TO_ALIGN[cell.ht];
  if (typeof cell.vt === 'number' && GRID_TO_VALIGN[cell.vt]) style.valign = GRID_TO_VALIGN[cell.vt];
  if (typeof cell.fs === 'number' && cell.fs !== 10) style.fontSize = cell.fs;
  if (cell.ct?.fa && cell.ct.fa !== DEFAULT_FORMAT && cell.ct.fa !== '@') style.format = cell.ct.fa;
  return Object.keys(style).length > 0 ? style : undefined;
}

function sheetCells(sheet: GridSheet): Array<{ r: number; c: number; cell: GridCell }> {
  if (Array.isArray(sheet.data)) {
    const cells: Array<{ r: number; c: number; cell: GridCell }> = [];
    sheet.data.forEach((row, r) => row?.forEach((cell, c) => { if (cell) cells.push({ r, c, cell }); }));
    return cells;
  }
  return (sheet.celldata ?? []).filter((entry) => entry.v).map((entry) => ({ r: entry.r, c: entry.c, cell: entry.v as GridCell }));
}

// A1 references and ranges in a formula; the prefix group is set for references to another sheet.
const REFERENCE = /(?<![A-Za-z0-9_.])((?:'[^']*'|[A-Za-z0-9_.]+)!)?\$?([A-Z]{1,3})\$?([1-9][0-9]*)(?::\$?([A-Z]{1,3})\$?([1-9][0-9]*))?(?![A-Za-z0-9_(])/g;

/** The same-sheet ranges a formula reads ("=B3/B$8" → B3, B8). Text in quotes is skipped. */
export function formulaReferences(formula: string): Array<{ r: number; c: number; rs: number; cs: number }> {
  const ranges: Array<{ r: number; c: number; rs: number; cs: number }> = [];
  const code = formula.replace(/"[^"]*"/g, '""');
  for (const match of code.matchAll(REFERENCE)) {
    if (match[1]) continue;
    const range = parseRange(match[4] ? `${match[2]}${match[3]}:${match[4]}${match[5]}` : `${match[2]}${match[3]}`);
    if (range) ranges.push(range);
  }
  return ranges;
}

/**
 * The formula cells of a sheet, each after the formula cells it reads, so that
 * computing them in this order never reads a formula that has no value yet.
 * Cycles are broken where they are met; references to other sheets are ignored.
 */
export function formulaOrder(sheet: GridSheet): Array<{ r: number; c: number }> {
  const formulas = sheetCells(sheet).filter(({ cell }) => typeof cell.f === 'string' && cell.f.trim() !== '');
  const reads = new Map(formulas.map(({ r, c, cell }) => [`${r}_${c}`, formulaReferences(cell.f!)]));
  const visited = new Set<string>();
  const order: Array<{ r: number; c: number }> = [];
  const visit = (r: number, c: number) => {
    const key = `${r}_${c}`;
    if (visited.has(key)) return;
    visited.add(key);
    for (const range of reads.get(key) ?? []) {
      for (const other of formulas) {
        if (other.r >= range.r && other.r < range.r + range.rs && other.c >= range.c && other.c < range.c + range.cs) visit(other.r, other.c);
      }
    }
    order.push({ r, c });
  };
  for (const { r, c } of formulas) visit(r, c);
  return order;
}

/** The file contents for the workbook the grid holds now. */
export function fromGridSheets(sheets: GridSheet[]): SheetDocument {
  const ordered = [...sheets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    format: SHEET_FORMAT,
    sheets: ordered.map((sheet): SheetData => {
      const cells: Record<string, SheetCellValue> = {};
      const styles: Record<string, SheetCellStyle> = {};
      for (const { r, c, cell } of sheetCells(sheet)) {
        // A cell covered by a merge holds nothing of its own.
        if (cell.mc && (cell.mc.r !== r || cell.mc.c !== c)) continue;
        const address = formatAddress(r, c);
        const value = readCellValue(cell);
        if (value !== undefined) cells[address] = value;
        const style = readCellStyle(cell);
        // Right alignment of a number is the default added on load, not a style of its own.
        if (style?.align === 'right' && isNumeric(value)) delete style.align;
        if (style && Object.keys(style).length > 0) styles[address] = style;
      }

      const merges = Object.values(sheet.config?.merge ?? {})
        .filter((range) => range.rs > 1 || range.cs > 1)
        .map((range) => `${formatAddress(range.r, range.c)}:${formatAddress(range.r + range.rs - 1, range.c + range.cs - 1)}`);
      const colWidths: Record<string, number> = {};
      for (const [index, width] of Object.entries(sheet.config?.columnlen ?? {})) {
        if (Number.isFinite(width)) colWidths[columnLetter(Number(index))] = Math.round(width);
      }
      const rowHeights: Record<string, number> = {};
      for (const [index, height] of Object.entries(sheet.config?.rowlen ?? {})) {
        if (Number.isFinite(height)) rowHeights[String(Number(index) + 1)] = Math.round(height);
      }

      const focus = sheet.frozen?.range;
      const frozen = !sheet.frozen
        ? undefined
        : sheet.frozen.type === 'row' ? { rows: 1, cols: 0 }
          : sheet.frozen.type === 'column' ? { rows: 0, cols: 1 }
            : sheet.frozen.type === 'both' ? { rows: 1, cols: 1 }
              : sheet.frozen.type === 'rangeRow' && focus ? { rows: focus.row_focus + 1, cols: 0 }
                : sheet.frozen.type === 'rangeColumn' && focus ? { rows: 0, cols: focus.column_focus + 1 }
                  : sheet.frozen.type === 'rangeBoth' && focus ? { rows: focus.row_focus + 1, cols: focus.column_focus + 1 }
                    : undefined;

      return {
        name: sheet.name,
        cells,
        ...(Object.keys(styles).length > 0 ? { styles } : {}),
        ...(merges.length > 0 ? { merges } : {}),
        ...(Object.keys(colWidths).length > 0 ? { colWidths } : {}),
        ...(Object.keys(rowHeights).length > 0 ? { rowHeights } : {}),
        ...(frozen ? { frozen } : {}),
      };
    }),
  };
}

/** The active sheet as CSV, the way the download offers it. Formulas export as written. */
export function sheetToCsv(sheet: SheetData): string {
  let maxRow = -1;
  let maxColumn = -1;
  const positions = Object.keys(sheet.cells).map((address) => ({ address, position: parseAddress(address) }));
  for (const { position } of positions) {
    if (!position) continue;
    maxRow = Math.max(maxRow, position.r);
    maxColumn = Math.max(maxColumn, position.c);
  }
  const quote = (value: SheetCellValue | undefined) => {
    if (value === undefined || value === null) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines: string[] = [];
  for (let r = 0; r <= maxRow; r += 1) {
    const row: string[] = [];
    for (let c = 0; c <= maxColumn; c += 1) row.push(quote(sheet.cells[formatAddress(r, c)]));
    lines.push(row.join(','));
  }
  return lines.join('\r\n');
}
