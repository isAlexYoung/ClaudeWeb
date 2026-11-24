/**
 * How each kind of artefact is stored: its file extension, size limit, what a
 * new one contains, how the file is read and written, and what Claude is told
 * about it. The service reads and writes every artefact through these.
 */
import {
  MAX_DOC_BYTES,
  blankDocDocument,
  docEditingInstructions,
  validateDocDocument,
} from '@/modules/artefacts/doc-format.js';
import {
  MAX_SHEET_BYTES,
  blankSheetDocument,
  sheetEditingInstructions,
  validateSheetDocument,
} from '@/modules/artefacts/sheet-format.js';
import {
  MAX_WHITEBOARD_BYTES,
  blankWhiteboardDocument,
  validateWhiteboardDocument,
  whiteboardEditingInstructions,
} from '@/modules/artefacts/whiteboard-format.js';
import type { ArtefactKind } from '@/modules/database/index.js';

export type ArtefactFormat = {
  kind: ArtefactKind;
  /** Appended to the artefact's id to name its file in ~/Artefacts. */
  extension: string;
  maxBytes: number;
  /** How errors name the artefact ("The spreadsheet changed …"). */
  noun: string;
  blank(): unknown;
  /** The reason the content cannot be stored, or null. */
  validate(content: unknown): string | null;
  /** The file's text for valid content. */
  serialize(content: unknown): string;
  /** The content of a file's text, or why it cannot be used. */
  parse(text: string): { content: unknown; error: string | null };
  instructions(filePath: string, title: string): string;
};

function jsonFormat(base: Omit<ArtefactFormat, 'serialize' | 'parse'>): ArtefactFormat {
  return {
    ...base,
    serialize: (content) => `${JSON.stringify(content, null, 2)}\n`,
    parse(text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { content: null, error: 'The file is not valid JSON.' };
      }
      const problem = base.validate(parsed);
      return problem ? { content: null, error: problem } : { content: parsed, error: null };
    },
  };
}

const FORMATS: Record<ArtefactKind, ArtefactFormat> = {
  sheet: jsonFormat({
    kind: 'sheet',
    extension: '.sheet.json',
    maxBytes: MAX_SHEET_BYTES,
    noun: 'spreadsheet',
    blank: blankSheetDocument,
    validate: validateSheetDocument,
    instructions: sheetEditingInstructions,
  }),
  whiteboard: jsonFormat({
    kind: 'whiteboard',
    extension: '.excalidraw',
    maxBytes: MAX_WHITEBOARD_BYTES,
    noun: 'whiteboard',
    blank: blankWhiteboardDocument,
    validate: validateWhiteboardDocument,
    instructions: whiteboardEditingInstructions,
  }),
  doc: {
    kind: 'doc',
    extension: '.md',
    maxBytes: MAX_DOC_BYTES,
    noun: 'document',
    blank: blankDocDocument,
    validate: validateDocDocument,
    serialize: (content) => String(content),
    parse(text) {
      const problem = validateDocDocument(text);
      return problem ? { content: null, error: problem } : { content: text, error: null };
    },
    instructions: docEditingInstructions,
  },
};

/** The kinds that can be created and edited. */
export const EDITABLE_KINDS = Object.keys(FORMATS) as ArtefactKind[];

export function isEditableKind(kind: unknown): kind is ArtefactKind {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(FORMATS, kind);
}

export function getArtefactFormat(kind: ArtefactKind): ArtefactFormat {
  return FORMATS[kind];
}
