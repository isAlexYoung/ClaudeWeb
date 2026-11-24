import { lazy } from 'react';

// ArtefactsPage: rendered by WorkspaceMain when the sidebar's Artefacts entry is open.
export { default as ArtefactsPage } from '@/modules/artefacts/ArtefactsPage';

// ArtefactSessionCard: rendered at the top of an artefact's Chat conversation.
export { default as ArtefactSessionCard } from '@/modules/artefacts/ArtefactSessionCard';

// ArtefactEditor: rendered by WorkspaceMain in the split view; picks the
// spreadsheet, document or whiteboard editor (each loaded on demand).
export { default as ArtefactEditor } from '@/modules/artefacts/ArtefactEditor';

// Shared hooks for sidebar icon tagging and Chat conversation artefact lookup.
export {
  getCachedArtefact,
  notifyArtefactsChanged,
  useArtefactBySessionId,
  useArtefactSessionIds,
} from '@/modules/artefacts/useArtefacts';

// Empty-state prompt suggestions shared by the split-view ChatInterface when an artefact has no messages yet.
export { SheetConversationEmptyState } from '@/modules/artefacts/sheet/SheetConversation';

// The i18n key of a string that differs by artefact kind (e.g. the Chat composer's placeholder).
export { kindTextKey } from '@/modules/artefacts/editor/kindText';
export { isEditableKind } from '@/modules/artefacts/artefactKinds';

// SpreadsheetEditor: kept for callers that open a spreadsheet directly. Loaded on
// demand, so FortuneSheet (and its styles) only download when a spreadsheet opens.
export const SpreadsheetEditor = lazy(() => import('@/modules/artefacts/sheet/SpreadsheetEditor'));
