import { lazy } from 'react';

// ArtefactsPage: rendered by WorkspaceMain when the sidebar's Artefacts entry is open.
export { default as ArtefactsPage } from '@/modules/artefacts/ArtefactsPage';

// ArtefactSessionCard: rendered at the top of an artefact's Chat conversation.
export { default as ArtefactSessionCard } from '@/modules/artefacts/ArtefactSessionCard';

// Shared hooks for sidebar icon tagging and Chat conversation artefact lookup.
export {
  getCachedArtefact,
  notifyArtefactsChanged,
  useArtefactBySessionId,
  useArtefactSessionIds,
} from '@/modules/artefacts/useArtefacts';

// Empty-state prompt suggestions shared by the split-view ChatInterface when a spreadsheet has no messages yet.
export { SheetConversationEmptyState } from '@/modules/artefacts/sheet/SheetConversation';

// SpreadsheetEditor: rendered by WorkspaceMain for an opened spreadsheet. Loaded on
// demand, so FortuneSheet (and its styles) only download when a spreadsheet opens.
export const SpreadsheetEditor = lazy(() => import('@/modules/artefacts/sheet/SpreadsheetEditor'));
