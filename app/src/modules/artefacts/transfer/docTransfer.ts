import type { Editor, JSONContent } from '@tiptap/react';
import type * as Docx from 'docx';

import { docExtensions } from '@/modules/artefacts/doc/docExtensions';

/**
 * Converts documents between their Markdown file and Word (.docx), and prints
 * them for "Save as PDF". Every conversion goes through a headless Tiptap
 * editor with the document editor's own extensions, so what comes out reads
 * as the editor shows it. docx and mammoth load only when used.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The largest document file the server accepts (doc-format.ts). */
export const MAX_DOC_BYTES = 2 * 1024 * 1024;

async function headlessEditor(): Promise<Editor> {
  const { Editor: TiptapEditor } = await import('@tiptap/react');
  return new TiptapEditor({ extensions: docExtensions(), content: '' });
}

/** Markdown read the way the document editor reads it, as Tiptap's JSON. */
export async function markdownToJson(markdown: string): Promise<JSONContent> {
  const editor = await headlessEditor();
  try {
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    return editor.getJSON();
  } finally {
    editor.destroy();
  }
}

/** Markdown as HTML, for printing. */
export async function markdownToHtml(markdown: string): Promise<string> {
  const editor = await headlessEditor();
  try {
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    return editor.getHTML();
  } finally {
    editor.destroy();
  }
}

/** HTML (from a Word file) as the Markdown the document editor would save. */
export async function htmlToMarkdown(html: string): Promise<string> {
  const editor = await headlessEditor();
  try {
    editor.commands.setContent(html, { emitUpdate: false });
    return editor.getMarkdown();
  } finally {
    editor.destroy();
  }
}

/* ------------------------------------------------------------------ */
/*  Word export                                                        */
/* ------------------------------------------------------------------ */

type DocxModule = typeof Docx;
type Block = Docx.Paragraph | Docx.Table;
type Inline = Docx.ParagraphChild;

/** Images ready to embed, by source. */
type EmbeddedImages = Map<string, { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number }>;

const ORDERED_REFERENCE = 'claudeweb-ordered';
const MAX_IMAGE_WIDTH = 600;
const CODE_FONT = 'Consolas';
const INDENT_STEP = 720;
/** Word paragraph styles for code and quotes, so they keep their names in Word and come back as code and quotes. */
const CODE_STYLE = 'Code';
const QUOTE_STYLE = 'Quote';

const IMAGE_TYPES: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

function collectImageSources(node: JSONContent, sources: Set<string>): void {
  if (node.type === 'image' && typeof node.attrs?.src === 'string') sources.add(node.attrs.src);
  for (const child of node.content ?? []) collectImageSources(child, sources);
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      // Unknown size: fall back below.
    }
  }
  return { width: 480, height: 320 };
}

/** Fetches the images a document shows; ones that cannot be read (another site, an unsupported type) stay as their text. */
async function embedImages(document: JSONContent): Promise<EmbeddedImages> {
  const sources = new Set<string>();
  collectImageSources(document, sources);
  const images: EmbeddedImages = new Map();
  await Promise.all([...sources].map(async (source) => {
    try {
      const response = await fetch(source);
      if (!response.ok) return;
      const blob = await response.blob();
      const type = IMAGE_TYPES[blob.type.toLowerCase()];
      if (!type) return;
      const size = await imageSize(blob);
      const scale = size.width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / size.width : 1;
      images.set(source, {
        data: new Uint8Array(await blob.arrayBuffer()),
        type,
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
      });
    } catch {
      // Left as text.
    }
  }));
  return images;
}

type Context = {
  docx: DocxModule;
  images: EmbeddedImages;
  /** Each ordered list counts from 1 again. */
  nextListInstance: () => number;
};

type BlockOptions = {
  indentLevel: number;
  quote: boolean;
};

function inlineRuns(nodes: JSONContent[] | undefined, context: Context, base: Partial<Docx.IRunOptions> = {}): Inline[] {
  const { docx } = context;
  const runs: Inline[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      runs.push(new docx.TextRun({ ...base, text: '', break: 1 }));
      continue;
    }
    if (node.type === 'image') {
      const source = String(node.attrs?.src ?? '');
      const image = context.images.get(source);
      if (image) runs.push(new docx.ImageRun({ type: image.type, data: image.data, transformation: { width: image.width, height: image.height } }));
      else runs.push(new docx.TextRun({ ...base, text: String(node.attrs?.alt || source) }));
      continue;
    }
    if (node.type !== 'text' || !node.text) continue;
    const marks = node.marks ?? [];
    const options: Docx.IRunOptions = {
      ...base,
      text: node.text,
      ...(marks.some((mark) => mark.type === 'bold') ? { bold: true } : {}),
      ...(marks.some((mark) => mark.type === 'italic') ? { italics: true } : {}),
      ...(marks.some((mark) => mark.type === 'strike') ? { strike: true } : {}),
      ...(marks.some((mark) => mark.type === 'code')
        ? { font: CODE_FONT, shading: { type: docx.ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' } }
        : {}),
    };
    const link = marks.find((mark) => mark.type === 'link');
    const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : '';
    if (href) {
      runs.push(new docx.ExternalHyperlink({ link: href, children: [new docx.TextRun({ ...options, style: 'Hyperlink' })] }));
    } else {
      runs.push(new docx.TextRun(options));
    }
  }
  return runs;
}

function quoteBorder(docx: DocxModule): Docx.IBordersOptions {
  return { left: { style: docx.BorderStyle.SINGLE, size: 12, color: 'BFBFBF', space: 8 } };
}

function paragraph(context: Context, options: BlockOptions, extra: Docx.IParagraphOptions): Docx.Paragraph {
  const { docx } = context;
  const indent = options.indentLevel > 0 && !extra.bullet && !extra.numbering
    ? { indent: { left: INDENT_STEP * options.indentLevel } }
    : {};
  const plain = !extra.heading && !extra.bullet && !extra.numbering && !extra.style;
  return new docx.Paragraph({
    ...indent,
    ...(options.quote ? { border: quoteBorder(docx) } : {}),
    ...(options.quote && plain ? { style: QUOTE_STYLE } : {}),
    ...extra,
  });
}

function listBlocks(node: JSONContent, context: Context, options: BlockOptions, level: number): Block[] {
  const blocks: Block[] = [];
  const instance = node.type === 'orderedList' ? context.nextListInstance() : 0;
  for (const item of node.content ?? []) {
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
        blocks.push(...listBlocks(child, context, options, level + 1));
        continue;
      }
      if (first && child.type === 'paragraph') {
        first = false;
        if (node.type === 'bulletList') {
          blocks.push(paragraph(context, options, { bullet: { level }, children: inlineRuns(child.content, context) }));
        } else if (node.type === 'orderedList') {
          blocks.push(paragraph(context, options, { numbering: { reference: ORDERED_REFERENCE, level, instance }, children: inlineRuns(child.content, context) }));
        } else {
          const box = item.attrs?.checked ? '☒ ' : '☐ ';
          blocks.push(paragraph(context, { ...options, indentLevel: options.indentLevel + level + 1 }, {
            children: [new context.docx.TextRun({ text: box }), ...inlineRuns(child.content, context)],
          }));
        }
        continue;
      }
      blocks.push(...nodeBlocks(child, context, { ...options, indentLevel: options.indentLevel + level + 1 }));
    }
  }
  return blocks;
}

function tableBlock(node: JSONContent, context: Context): Docx.Table {
  const { docx } = context;
  const rows = (node.content ?? []).map((row) => new docx.TableRow({
    // Marked as Word's header row: repeated on each page, and read back as the table's header.
    tableHeader: (row.content ?? []).length > 0 && (row.content ?? []).every((cell) => cell.type === 'tableHeader'),
    children: (row.content ?? []).map((cell) => {
      const header = cell.type === 'tableHeader';
      const children = (cell.content ?? []).flatMap((child) => (
        child.type === 'paragraph'
          ? [new docx.Paragraph({ children: inlineRuns(child.content, context, header ? { bold: true } : {}) })]
          : nodeBlocks(child, context, { indentLevel: 0, quote: false })
      ));
      return new docx.TableCell({
        children: children.length > 0 ? children : [new docx.Paragraph('')],
        ...(header ? { shading: { type: docx.ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' } } : {}),
        ...(typeof cell.attrs?.colspan === 'number' && cell.attrs.colspan > 1 ? { columnSpan: cell.attrs.colspan } : {}),
        ...(typeof cell.attrs?.rowspan === 'number' && cell.attrs.rowspan > 1 ? { rowSpan: cell.attrs.rowspan } : {}),
      });
    }),
  }));
  return new docx.Table({ rows, width: { size: 100, type: docx.WidthType.PERCENTAGE } });
}

const HEADING_LEVELS = ['HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6'] as const;

function nodeBlocks(node: JSONContent, context: Context, options: BlockOptions): Block[] {
  const { docx } = context;
  switch (node.type) {
    case 'paragraph':
      return [paragraph(context, options, { children: inlineRuns(node.content, context) })];
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return [paragraph(context, options, { heading: docx.HeadingLevel[HEADING_LEVELS[level - 1]], children: inlineRuns(node.content, context) })];
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return listBlocks(node, context, options, 0);
    case 'blockquote':
      return (node.content ?? []).flatMap((child) => nodeBlocks(child, context, { ...options, quote: true }));
    case 'codeBlock': {
      // One paragraph with line breaks: Word would drop empty paragraphs on the way back, and blank lines with them.
      const lines = (node.content ?? []).map((child) => child.text ?? '').join('').split('\n');
      return [paragraph(context, options, {
        style: CODE_STYLE,
        shading: { type: docx.ShadingType.CLEAR, color: 'auto', fill: 'F5F5F5' },
        children: lines.map((line, index) => new docx.TextRun({ text: line, font: CODE_FONT, ...(index > 0 ? { break: 1 } : {}) })),
      })];
    }
    case 'horizontalRule':
      return [new docx.Paragraph({ border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } }, children: [] })];
    case 'table':
      return [tableBlock(node, context)];
    case 'image':
      return [paragraph(context, options, { children: inlineRuns([node], context) })];
    default:
      return node.content ? node.content.flatMap((child) => nodeBlocks(child, context, options)) : [];
  }
}

function orderedNumbering(docx: DocxModule): Docx.INumberingOptions {
  return {
    config: [{
      reference: ORDERED_REFERENCE,
      levels: Array.from({ length: 9 }, (_, level) => ({
        level,
        format: docx.LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: docx.AlignmentType.START,
        style: { paragraph: { indent: { left: INDENT_STEP * (level + 1), hanging: 360 } } },
      })),
    }],
  };
}

/** The document as a Word file. */
export async function markdownToDocx(markdown: string, title: string): Promise<Blob> {
  const docx = await import('docx') as DocxModule;
  const json = await markdownToJson(markdown);
  const images = await embedImages(json);
  let instance = 0;
  const context: Context = { docx, images, nextListInstance: () => { instance += 1; return instance; } };
  const children = (json.content ?? []).flatMap((node) => nodeBlocks(node, context, { indentLevel: 0, quote: false }));
  const document = new docx.Document({
    title,
    creator: 'ClaudeWeb',
    numbering: orderedNumbering(docx),
    styles: {
      paragraphStyles: [
        { id: CODE_STYLE, name: CODE_STYLE, basedOn: 'Normal', next: 'Normal', run: { font: CODE_FONT } },
        { id: QUOTE_STYLE, name: QUOTE_STYLE, basedOn: 'Normal', next: 'Normal', run: { color: '555555' } },
      ],
    },
    sections: [{ children: children.length > 0 ? children : [new docx.Paragraph('')] }],
  });
  return docx.Packer.toBlob(document);
}

/* ------------------------------------------------------------------ */
/*  Word import                                                        */
/* ------------------------------------------------------------------ */

type Mammoth = {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: { styleMap?: string[] }): Promise<{ value: string; messages: unknown[] }>;
};

/** Word paragraph styles read as code and quotes: ClaudeWeb's own, and Word's built-in ones. */
const WORD_STYLE_MAP = [
  `p[style-name='${CODE_STYLE}'] => pre:separator('\\n')`,
  "p[style-name='HTML Preformatted'] => pre:separator('\\n')",
  `p[style-name='${QUOTE_STYLE}'] => blockquote > p:fresh`,
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
];

async function loadMammoth(): Promise<Mammoth> {
  const module = await import('mammoth/mammoth.browser.js') as unknown as { default?: Mammoth } & Mammoth;
  return module.default ?? module;
}

const textEncoder = new TextEncoder();

const TASK_BOX = /^\s*([☐☑☒])\s?/;

/**
 * Turns the ☐/☒ paragraphs a Word export writes for a task list (and many
 * Word checklists use) back into one.
 */
function restoreTaskLists(document: Document): void {
  const paragraphs = [...document.body.querySelectorAll(':scope > p')].filter((p) => TASK_BOX.test(p.textContent ?? ''));
  let list: HTMLUListElement | null = null;
  for (const p of paragraphs) {
    const box = TASK_BOX.exec(p.textContent ?? '')?.[1];
    // Strip the box from the paragraph's first text.
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent?.trim()) continue;
      text.textContent = text.textContent.replace(TASK_BOX, '');
      break;
    }
    const item = document.createElement('li');
    item.setAttribute('data-type', 'taskItem');
    item.setAttribute('data-checked', box === '☐' ? 'false' : 'true');
    if (!list || list.nextElementSibling !== p) {
      list = document.createElement('ul');
      list.setAttribute('data-type', 'taskList');
      p.before(list);
    }
    list.append(item);
    item.append(p);
  }
}

/**
 * Fixes up what mammoth makes of a Word file before the editor reads it:
 * task lists are restored, code keeps its lines, and as a Markdown table needs a header row (most
 * Word tables do not mark one) a table without one has its first row taken
 * as the header, instead of Markdown getting an empty one. Bold covering a
 * whole header cell is dropped, since a header shows bold anyway.
 */
function normalizeWordHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  restoreTaskLists(document);
  // A code block's line breaks are its newlines.
  for (const lineBreak of [...document.querySelectorAll('pre br')]) lineBreak.replaceWith('\n');
  for (const table of document.querySelectorAll('table')) {
    const firstRow = table.querySelector('tr');
    if (!firstRow) continue;
    if (!table.querySelector('th')) {
      for (const cell of [...firstRow.children]) {
        if (cell.tagName !== 'TD') continue;
        const header = document.createElement('th');
        for (const attribute of [...cell.attributes]) header.setAttribute(attribute.name, attribute.value);
        header.innerHTML = cell.innerHTML;
        cell.replaceWith(header);
      }
    }
    for (const strong of [...table.querySelectorAll('th strong')]) {
      if (strong.parentElement && strong.parentElement.textContent?.trim() === strong.textContent?.trim()) strong.replaceWith(...strong.childNodes);
    }
  }
  return document.body.innerHTML;
}

/** A Word file as Markdown; images are dropped (and reported) when they would make the document too large. */
export async function docxToMarkdown(data: ArrayBuffer): Promise<{ markdown: string; droppedImages: boolean }> {
  const mammoth = await loadMammoth();
  const { value: converted } = await mammoth.convertToHtml({ arrayBuffer: data }, { styleMap: WORD_STYLE_MAP });
  const html = normalizeWordHtml(converted);
  const markdown = await htmlToMarkdown(html);
  if (textEncoder.encode(markdown).length <= MAX_DOC_BYTES || !/<img\b/i.test(html)) {
    return { markdown, droppedImages: false };
  }
  return { markdown: await htmlToMarkdown(html.replace(/<img\b[^>]*>/gi, '')), droppedImages: true };
}

/* ------------------------------------------------------------------ */
/*  PDF                                                                */
/* ------------------------------------------------------------------ */

const PRINT_STYLES = `
  @page { margin: 18mm 16mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    color: #1f1f1f;
    font: 11pt/1.65 "Source Serif 4", Georgia, "Songti SC", "SimSun", "Noto Serif CJK SC", serif;
  }
  h1, h2, h3, h4 { font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; line-height: 1.3; margin: 1.2em 0 0.5em; }
  h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  p { margin: 0 0 0.7em; }
  a { color: #1a5fb4; }
  code { font-family: Consolas, "SFMono-Regular", Menlo, monospace; font-size: 0.92em; background: #f2f2f2; padding: 0 0.2em; border-radius: 3px; }
  pre { background: #f5f5f5; padding: 10px 12px; border-radius: 6px; white-space: pre-wrap; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0 0 0.8em; padding-left: 12px; border-left: 3px solid #bfbfbf; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 0.6em 0 1em; break-inside: avoid; }
  th, td { border: 1px solid #c8c8c8; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  img { max-width: 100%; }
  hr { border: 0; border-top: 1px solid #bfbfbf; margin: 1.2em 0; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0.4em; }
  ul[data-type="taskList"] li { display: flex; gap: 0.5em; }
  ul[data-type="taskList"] li > label { flex: none; }
  ul[data-type="taskList"] li > div { flex: 1; }
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character));
}

/**
 * Opens the browser's print dialog for the document, where "Save as PDF"
 * writes the file. Printing keeps every script the system has fonts for,
 * which a PDF library would need to embed fonts to match.
 */
export async function printMarkdown(markdown: string, title: string): Promise<void> {
  const html = await markdownToHtml(markdown);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument || !frameWindow) {
    frame.remove();
    throw new Error('Printing is not available.');
  }
  frameDocument.open();
  frameDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_STYLES}</style></head><body>${html}</body></html>`);
  frameDocument.close();
  // Images must finish loading before the page is laid out for print.
  await Promise.all([...frameDocument.images].map((image) => (
    image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); })
  )));
  const remove = () => setTimeout(() => frame.remove(), 500);
  frameWindow.addEventListener('afterprint', remove, { once: true });
  frameWindow.focus();
  frameWindow.print();
  // Some browsers never fire afterprint for a frame; the frame goes after a minute regardless.
  setTimeout(() => frame.remove(), 60_000);
}
