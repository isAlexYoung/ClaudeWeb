/**
 * The spreadsheet file format, `claudeweb-sheet@1`.
 *
 * A spreadsheet is one JSON file keyed by A1 addresses, so Claude can change
 * a cell with an ordinary Edit and the editor can load it without a
 * converter on the server. The browser maps it to and from FortuneSheet's
 * own data (src/modules/artefacts/sheet/sheetFormat.ts).
 */

export const SHEET_FORMAT = 'claudeweb-sheet@1';

/** Largest file the API reads or writes. */
export const MAX_SHEET_BYTES = 5 * 1024 * 1024;

const A1_ADDRESS = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/;

export type SheetDocument = {
  format: typeof SHEET_FORMAT;
  sheets: Array<{
    name: string;
    cells: Record<string, string | number | boolean | null>;
    [key: string]: unknown;
  }>;
};

/** A new spreadsheet: one empty sheet. */
export function blankSheetDocument(): SheetDocument {
  return { format: SHEET_FORMAT, sheets: [{ name: 'Sheet1', cells: {} }] };
}

/**
 * Checks the shape the editor depends on and returns the reason when it is
 * wrong. Style, merge and size fields are passed through: the editor ignores
 * what it does not understand, and refusing a whole file over one would lose
 * Claude's work.
 */
export function validateSheetDocument(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The file is not a JSON object.';
  const document = value as Record<string, unknown>;
  if (document.format !== SHEET_FORMAT) return `"format" must be "${SHEET_FORMAT}".`;
  if (!Array.isArray(document.sheets) || document.sheets.length === 0) return '"sheets" must be a non-empty array.';
  const names = new Set<string>();
  for (const [index, sheet] of document.sheets.entries()) {
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return `Sheet ${index + 1} is not an object.`;
    const { name, cells } = sheet as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) return `Sheet ${index + 1} needs a "name".`;
    if (names.has(name)) return `Two sheets are named "${name}".`;
    names.add(name);
    if (!cells || typeof cells !== 'object' || Array.isArray(cells)) return `Sheet "${name}" needs a "cells" object.`;
    for (const [address, cell] of Object.entries(cells as Record<string, unknown>)) {
      if (!A1_ADDRESS.test(address)) return `Sheet "${name}" has a cell at "${address}", which is not an A1 address.`;
      if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)) {
        return `Cell ${name}!${address} must be a string, number, boolean or null.`;
      }
    }
  }
  return null;
}

/**
 * Appended to the system prompt of a turn that edits a spreadsheet: where the
 * file is and what it must look like afterwards.
 */
export function sheetEditingInstructions(filePath: string, title: string): string {
  return `You are editing the ClaudeWeb spreadsheet "${title}". It is stored in the file ${filePath}.
The user sees this spreadsheet in an editor next to the conversation; the editor reloads the file as soon as you change it.
Make the change the user asks for by editing that file (Read it first, then Edit or Write it). Do not create other files unless the user asks for them, and reply with a short summary of what you changed.
The file must stay valid JSON in the format "${SHEET_FORMAT}":
{
  "format": "${SHEET_FORMAT}",
  "sheets": [
    {
      "name": "Sheet1",
      "cells": { "A1": "Item", "B1": "Amount", "A2": "Rent", "B2": 3200, "B4": "=SUM(B2:B3)" },
      "styles": { "A1": { "bold": true, "bg": "#E8F0FE" }, "B4": { "format": "0.00" } },
      "merges": ["A6:C6"],
      "colWidths": { "A": 140 },
      "rowHeights": { "1": 28 },
      "frozen": { "rows": 1, "cols": 0 }
    }
  ]
}
Rules:
- "cells" maps A1 addresses to numbers, strings or booleans. A string starting with "=" is a formula using spreadsheet functions (SUM, AVERAGE, IF, VLOOKUP, ...). Store numbers as JSON numbers, not strings.
- "styles" is optional, keyed by A1 address. Keys: bold, italic, underline (booleans), color and bg (hex colors), align ("left" | "center" | "right"), valign ("top" | "middle" | "bottom"), fontSize (number), format (number format such as "0.00", "#,##0", "0%", "yyyy-mm-dd").
- "merges" is optional: ranges like "A1:C1". "colWidths" (by column letter) and "rowHeights" (by row number) are pixels. "frozen" freezes the top rows and left columns.
- Sheet names must be unique. Keep every existing sheet unless the user asks to remove it.`;
}
