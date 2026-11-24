import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { SheetDocument } from '@/shared/types';
import {
  columnIndex,
  columnLetter,
  formulaOrder,
  formulaReferences,
  fromGridSheets,
  parseAddress,
  sheetToCsv,
  toGridSheets,
} from '@/modules/artefacts/sheet/sheetFormat';
import type { GridSheet } from '@/modules/artefacts/sheet/sheetFormat';

const BUDGET: SheetDocument = {
  format: 'claudeweb-sheet@1',
  sheets: [
    {
      name: 'Budget',
      cells: {
        A1: 'Monthly budget',
        A2: 'Item', B2: 'Amount', C2: 'Share',
        A3: 'Rent', B3: 3200, C3: '=B3/B$8',
        A4: 'Food', B4: 1800, C4: '=B4/B$8',
        A8: 'Total', B8: '=SUM(B3:B4)', C8: '=SUM(C3:C4)',
        D1: true,
      },
      styles: {
        A1: { bold: true, fontSize: 14, bg: '#dbeafe' },
        B2: { align: 'right', italic: true },
        C3: { format: '0.0%' },
        B8: { bold: true, format: '#,##0.00', color: '#b91c1c' },
        A2: { underline: true, valign: 'top' },
      },
      merges: ['A1:C1'],
      colWidths: { A: 120, C: 64 },
      rowHeights: { 1: 32 },
      frozen: { rows: 2, cols: 0 },
    },
    { name: 'Notes', cells: { B2: 'see "Budget", page 2' } },
  ],
};

test('column letters and A1 addresses convert both ways', () => {
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
  assert.equal(columnLetter(701), 'ZZ');
  assert.equal(columnIndex('AA'), 26);
  assert.equal(columnIndex('a'), -1);
  assert.deepEqual(parseAddress('c12'), { r: 11, c: 2 });
  assert.equal(parseAddress('A0'), null);
  assert.equal(parseAddress('12'), null);
});

test('a file survives the trip through the grid with values, formulas, styles, merges, sizes and frozen rows', () => {
  const grid = toGridSheets(BUDGET);
  assert.equal(grid.length, 2);
  assert.deepEqual(grid.map((sheet) => sheet.id), ['sheet-1', 'sheet-2']);
  assert.equal(grid[0].row! >= 100 && grid[0].column! >= 26, true, 'the grid leaves room to type');
  assert.deepEqual(grid[0].frozen, { type: 'rangeRow', range: { row_focus: 1, column_focus: 0 } });

  const cell = (r: number, c: number) => grid[0].celldata!.find((entry) => entry.r === r && entry.c === c)?.v;
  assert.deepEqual(cell(0, 0)!.mc, { r: 0, c: 0, rs: 1, cs: 3 });
  assert.deepEqual(cell(0, 1)!.mc, { r: 0, c: 0 }, 'cells under a merge point at its top-left cell');
  assert.equal(cell(2, 2)!.f, '=B3/B$8');
  assert.equal(cell(2, 2)!.ct!.fa, '0.0%');
  assert.equal(cell(2, 1)!.ht, 2, 'numbers align right in the grid');

  assert.deepEqual(fromGridSheets(grid), BUDGET);
});

test('what the user does in the grid reaches the file', () => {
  const grid = toGridSheets(BUDGET);
  // FortuneSheet hands back its own shape: a dense matrix with typed values as strings.
  const data = Array.from({ length: 10 }, () => Array.from({ length: 5 }, () => null as unknown));
  for (const { r, c, v } of grid[0].celldata!) data[r][c] = v;
  data[4][1] = { v: '950', m: '950', ct: { fa: 'General', t: 'n' } };
  data[5][0] = { ct: { fa: 'General', t: 'inlineStr', s: [{ v: 'Tra' }, { v: 'vel' }] } };
  data[5][1] = { v: 120, ct: { fa: 'General', t: 'n' }, ht: 0, fc: '#000000' };
  data[1][2] = { v: 'Share', m: 'Share', ht: 1 };
  const edited: GridSheet = { ...grid[0], celldata: undefined, data: data as GridSheet['data'], frozen: { type: 'both' } };

  const sheet = fromGridSheets([edited, grid[1]]).sheets[0];
  assert.equal(sheet.cells.B5, 950);
  assert.equal(sheet.cells.A6, 'Travel');
  assert.equal(sheet.cells.B6, 120);
  assert.deepEqual(sheet.styles!.B6, { align: 'center' }, 'a chosen alignment is kept, the default text colour is not');
  assert.deepEqual(sheet.styles!.C2, { align: 'left' });
  assert.equal(sheet.styles!.B3, undefined, 'the right alignment a number gets on load is not written back');
  assert.deepEqual(sheet.frozen, { rows: 1, cols: 1 });
});

test('formula references ignore functions, quoted text and other sheets', () => {
  assert.deepEqual(formulaReferences('=B3/B$8'), [{ r: 2, c: 1, rs: 1, cs: 1 }, { r: 7, c: 1, rs: 1, cs: 1 }]);
  assert.deepEqual(formulaReferences('=SUM($B$3:B7)'), [{ r: 2, c: 1, rs: 5, cs: 1 }]);
  assert.deepEqual(formulaReferences('=LOG10(A1)&"C9"'), [{ r: 0, c: 0, rs: 1, cs: 1 }]);
  assert.deepEqual(formulaReferences("=Notes!A1+'My sheet'!B2+C3"), [{ r: 2, c: 2, rs: 1, cs: 1 }]);
});

test('formulas are computed after the formulas they read, even across a cycle', () => {
  const [budget] = toGridSheets(BUDGET);
  const order = formulaOrder(budget).map(({ r, c }) => `${columnLetter(c)}${r + 1}`);
  assert.deepEqual(order, ['B8', 'C3', 'C4', 'C8']);

  const [cycle] = toGridSheets({ format: 'claudeweb-sheet@1', sheets: [{ name: 'S', cells: { A1: '=B1', B1: '=A1', C1: '=A1+B1' } }] });
  const cyclic = formulaOrder(cycle).map(({ r, c }) => `${columnLetter(c)}${r + 1}`);
  assert.deepEqual([...cyclic].sort(), ['A1', 'B1', 'C1']);
  assert.equal(cyclic.at(-1), 'C1');
});

test('CSV export quotes what needs quoting and keeps formulas as written', () => {
  assert.equal(
    sheetToCsv({ name: 'S', cells: { A1: 'a,b', B1: 'say "hi"', A2: 3, C2: '=A2*2' } }),
    '"a,b","say ""hi""",\r\n3,,=A2*2',
  );
  assert.equal(sheetToCsv({ name: 'Empty', cells: {} }), '');
});
