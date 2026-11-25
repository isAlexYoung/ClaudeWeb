import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { SheetDocument } from '@/shared/types';
import { SHEET_FORMAT } from '@/modules/artefacts/sheet/sheetFormat';
import {
  argbToCss,
  cssToArgb,
  delimitedToSheetDocument,
  detectDelimiter,
  parseDelimited,
  sheetDocumentToXlsx,
  themeColorToCss,
  xlsxToSheetDocument,
} from '@/modules/artefacts/transfer/sheetTransfer';
import { docxToMarkdown, markdownToDocx } from '@/modules/artefacts/transfer/docTransfer';
import { parseWhiteboardFile } from '@/modules/artefacts/transfer/whiteboardTransfer';
import { ArtefactImportError, importKindOf, readImportFile } from '@/modules/artefacts/transfer/artefactTransfer';

/**
 * jsdom's File has no arrayBuffer(), and Node's returns an ArrayBuffer from
 * another realm than the test's globals (which JSZip then refuses); a
 * browser's File has neither problem, so the tests read files through this.
 */
const file = (name: string, content: string | Uint8Array) => {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer } as unknown as File;
};

// ExcelJS, docx, mammoth and Tiptap take a few seconds to load the first time.
const SLOW = 30_000;

const readBytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});

const importError = (code: string) => (error: unknown) => error instanceof ArtefactImportError && error.code === code;

test('colours convert between CSS hex and Excel ARGB', () => {
  assert.equal(cssToArgb('#1a73e8'), 'FF1A73E8');
  assert.equal(cssToArgb('#abc'), 'FFAABBCC');
  assert.equal(cssToArgb('red'), null);
  assert.equal(argbToCss('FF1A73E8'), '#1A73E8');
  assert.equal(argbToCss(undefined), null);
  // Theme colours use the Office palette, lightened or darkened by their tint.
  assert.equal(themeColorToCss(4), '#4472C4');
  assert.equal(themeColorToCss(0, -0.15), '#D9D9D9');
  assert.equal(themeColorToCss(1, 0.5), '#808080');
  assert.equal(themeColorToCss(42), null);
});

test('a spreadsheet survives the trip through an Excel workbook', async () => {
  const document: SheetDocument = {
    format: SHEET_FORMAT,
    sheets: [
      {
        name: '预算',
        cells: { A1: '项目', B1: '金额', A2: '房租', B2: 3000, A3: '合计', B3: '=SUM(B2:B2)', C1: true },
        styles: { A1: { bold: true, bg: '#FFF2CC', align: 'center' }, B2: { format: '#,##0.00', color: '#C00000' } },
        merges: ['D1:E2'],
        colWidths: { A: 140 },
        rowHeights: { 1: 32 },
        frozen: { rows: 1, cols: 0 },
      },
      { name: 'Bad/name?', cells: { A1: 'x' } },
    ],
  };
  const workbook = await sheetDocumentToXlsx(document);
  const { document: back, warnings } = await xlsxToSheetDocument(workbook);
  assert.deepEqual(warnings, []);
  assert.deepEqual(back.sheets.map((sheet) => sheet.name), ['预算', 'Bad name']);
  const [sheet] = back.sheets;
  assert.deepEqual(sheet.cells, document.sheets[0].cells);
  assert.deepEqual(sheet.styles?.A1, { bold: true, bg: '#FFF2CC', align: 'center' });
  assert.deepEqual(sheet.styles?.B2, { color: '#C00000', format: '#,##0.00' });
  assert.deepEqual(sheet.merges, ['D1:E2']);
  assert.equal(sheet.colWidths?.A, 140);
  assert.equal(sheet.rowHeights?.['1'], 32);
  assert.deepEqual(sheet.frozen, { rows: 1, cols: 0 });
}, SLOW);

test('a workbook date becomes a date serial with a date format', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Dates');
  worksheet.getCell('A1').value = new Date(Date.UTC(2026, 10, 25));
  worksheet.getCell('A2').value = { richText: [{ text: 'rich ' }, { text: 'text', font: { bold: true } }] };
  worksheet.getCell('A3').value = { text: 'ClaudeWeb', hyperlink: 'https://example.com' };
  worksheet.getCell('A4').note = 'a comment';
  worksheet.getCell('A4').value = 'noted';
  worksheet.getCell('B1').value = 'themed';
  worksheet.getCell('B1').font = { color: { theme: 4 } as never };
  worksheet.getCell('B1').fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 0, tint: -0.15 } as never };
  const { document, warnings } = await xlsxToSheetDocument(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  const cells = document.sheets[0].cells;
  assert.equal(cells.A1, 46351);
  assert.equal(document.sheets[0].styles?.A1?.format, 'yyyy-mm-dd');
  assert.equal(cells.A2, 'rich text');
  assert.equal(cells.A3, 'ClaudeWeb');
  // Theme colours come in as the Office theme's.
  assert.deepEqual(document.sheets[0].styles?.B1, { color: '#4472C4', bg: '#D9D9D9' });
  assert.deepEqual(warnings, ['comments']);
}, SLOW);

test('delimited text: quoted fields, the delimiter found from the lines, numbers kept but codes left as text', () => {
  assert.deepEqual(parseDelimited('a,"b,c","say ""hi"""\r\n"multi\nline",2\n', ','), [
    ['a', 'b,c', 'say "hi"'],
    ['multi\nline', '2'],
  ]);
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2\n'), '\t');
  assert.equal(detectDelimiter('名称,数量\n苹果,3\n'), ',');
  const document = delimitedToSheetDocument('﻿名称,数量,编号,有效\n苹果,3.5,007,TRUE\n', 'fruit:list');
  assert.deepEqual(document.sheets[0], {
    name: 'fruit list',
    cells: { A1: '名称', B1: '数量', C1: '编号', D1: '有效', A2: '苹果', B2: 3.5, C2: '007', D2: true },
  });
});

test('a document becomes a Word file and comes back as the same Markdown', async () => {
  const markdown = [
    '# 周报',
    '',
    'Some **bold** and *italic* text with a [link](https://example.com).',
    '',
    '- first',
    '- second',
    '',
    '1. one',
    '2. two',
    '',
    '| Name | Count |',
    '| --- | --- |',
    '| apples | 3 |',
    '',
    '- [x] shipped',
    '- [ ] tested',
    '',
    '> quoted words',
    '',
    '```',
    'const a = 1;',
    '',
    'return a;',
    '```',
    '',
  ].join('\n');
  const blob = await markdownToDocx(markdown, '周报');
  const bytes = await readBytes(blob);
  // A .docx is a zip file.
  assert.deepEqual([...new Uint8Array(bytes).slice(0, 2)], [0x50, 0x4b]);

  const { markdown: back, droppedImages } = await docxToMarkdown(bytes);
  assert.equal(droppedImages, false);
  assert.match(back, /^# 周报$/m);
  assert.match(back, /\*\*bold\*\*/);
  assert.match(back, /\*italic\*/);
  assert.match(back, /\[link\]\(https:\/\/example\.com\/?\)/);
  assert.match(back, /^[-*] first$/m);
  assert.match(back, /^1\. one$/m);
  // The header row comes back as the header, not as an empty row above a bold one.
  const table = back.split('\n').filter((line) => line.startsWith('|'));
  assert.match(table[0], /^\| *Name *\| *Count *\|$/);
  assert.match(table[1], /^\| *-+ *\| *-+ *\|$/);
  assert.match(table[2], /^\| *apples *\| *3 *\|$/);
  // Task lists, quotes and code blocks (blank line included) come back as themselves.
  assert.match(back, /^- \[x\] shipped$/m);
  assert.match(back, /^- \[ \] tested$/m);
  assert.match(back, /^> quoted words$/m);
  assert.match(back, /```\nconst a = 1;\n\nreturn a;\n```/);
}, SLOW);

test('a Word table that marks no header row has its first row taken as the header', async () => {
  const docx = await import('docx');
  const cell = (text: string, bold = false) => new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text, bold })] })] });
  const word = new docx.Document({
    sections: [{
      children: [new docx.Table({
        rows: [
          new docx.TableRow({ children: [cell('城市', true), cell('人口', true)] }),
          new docx.TableRow({ children: [cell('上海'), cell('2487')] }),
        ],
      })],
    }],
  });
  const { markdown } = await docxToMarkdown(await readBytes(await docx.Packer.toBlob(word)));
  const table = markdown.split('\n').filter((line) => line.startsWith('|'));
  assert.equal(table.length, 3);
  assert.match(table[0], /^\| *城市 *\| *人口 *\|$/);
  assert.match(table[2], /^\| *上海 *\| *2487 *\|$/);
}, SLOW);

test('a whiteboard file must be an Excalidraw scene; only its background is kept from the view', () => {
  const scene = parseWhiteboardFile(JSON.stringify({
    type: 'excalidraw', version: 2, source: 'https://excalidraw.com',
    elements: [{ type: 'rectangle', id: 'r' }],
    appState: { viewBackgroundColor: '#fafafa', zoom: { value: 2 }, theme: 'dark' },
  }));
  assert.deepEqual(scene, {
    type: 'excalidraw', version: 2, source: 'claudeweb',
    elements: [{ type: 'rectangle', id: 'r' }], appState: { viewBackgroundColor: '#fafafa' }, files: {},
  });
  assert.equal(parseWhiteboardFile('not json'), null);
  assert.equal(parseWhiteboardFile(JSON.stringify({ type: 'tldraw', elements: [] })), null);
  assert.equal(parseWhiteboardFile(JSON.stringify({ type: 'excalidraw', elements: [{ x: 1 }] })), null);
});

test('importing picks the kind from the extension and names the artefact after the file', async () => {
  assert.equal(importKindOf('Report.XLSX'), 'sheet');
  assert.equal(importKindOf('notes.markdown'), 'doc');
  assert.equal(importKindOf('flow.excalidraw'), 'whiteboard');
  assert.equal(importKindOf('photo.png'), null);

  const csv = await readImportFile(file('销售.csv', '月份,金额\n1月,100\n'));
  assert.equal(csv.kind, 'sheet');
  assert.equal(csv.title, '销售');
  assert.deepEqual((csv.content as SheetDocument).sheets[0].cells, { A1: '月份', B1: '金额', A2: '1月', B2: 100 });

  const tsv = await readImportFile(file('t.tsv', 'a,b\tc\n'));
  assert.deepEqual((tsv.content as SheetDocument).sheets[0].cells, { A1: 'a,b', B1: 'c' });

  // GBK, as older Chinese spreadsheets save CSV.
  const gbk = await readImportFile(file('gbk.csv', new Uint8Array([0xc3, 0xfb, 0xb3, 0xc6, 0x2c, 0x31, 0x0a])));
  assert.deepEqual((gbk.content as SheetDocument).sheets[0].cells, { A1: '名称', B1: 1 });

  const doc = await readImportFile(file('README.md', '# Hi\n'));
  assert.deepEqual({ kind: doc.kind, title: doc.title, content: doc.content }, { kind: 'doc', title: 'README', content: '# Hi\n' });

  const board = await readImportFile(file('flow.excalidraw', JSON.stringify({ type: 'excalidraw', elements: [] })));
  assert.equal(board.kind, 'whiteboard');

  const workbook = await readImportFile(file('book.xlsx', new Uint8Array(await sheetDocumentToXlsx({
    format: SHEET_FORMAT, sheets: [{ name: 'S', cells: { A1: 1 } }],
  }))));
  assert.deepEqual((workbook.content as SheetDocument).sheets[0].cells, { A1: 1 });
}, SLOW);

test('importing refuses old Office files, unknown files, broken files and files over the limit', async () => {
  await assert.rejects(readImportFile(file('old.xls', 'x')), importError('legacy'));
  await assert.rejects(readImportFile(file('old.doc', 'x')), importError('legacy'));
  await assert.rejects(readImportFile(file('photo.png', 'x')), importError('unsupported'));
  await assert.rejects(readImportFile(file('broken.xlsx', 'not a zip')), importError('invalid'));
  await assert.rejects(readImportFile(file('broken.docx', 'not a zip')), importError('invalid'));
  await assert.rejects(readImportFile(file('scene.excalidraw', '{}')), importError('invalid'));
  // Any other JSON file is just not a whiteboard.
  await assert.rejects(readImportFile(file('package.json', '{"name":"x"}')), importError('unsupported'));
  await assert.rejects(
    readImportFile(file('big.md', 'x'.repeat(2 * 1024 * 1024 + 1))),
    (error: unknown) => importError('tooLarge')(error) && (error as ArtefactImportError).limitBytes === 2 * 1024 * 1024,
  );
}, SLOW);
