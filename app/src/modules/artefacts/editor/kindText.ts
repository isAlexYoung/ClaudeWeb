import type { EditableArtefactKind } from '@/modules/artefacts/useArtefacts';

/** Where each editor's own strings live in the sidebar namespace (the spreadsheet's predate the others). */
const GROUP: Record<EditableArtefactKind, string> = {
  sheet: 'artefacts.editor',
  doc: 'artefacts.docEditor',
  whiteboard: 'artefacts.whiteboardEditor',
};

/**
 * The i18n key for a string that differs by kind (placeholder, "Claude is
 * editing…", the conversation's empty state); shared strings such as
 * "Saving…" stay under `artefacts.editor`.
 */
export function kindTextKey(kind: EditableArtefactKind, key: string): string {
  return `${GROUP[kind]}.${key}`;
}
