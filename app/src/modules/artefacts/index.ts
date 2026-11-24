import { lazy } from 'react';

// ArtefactsPage: rendered by WorkspaceMain when the sidebar's Artefacts entry is open.
export { default as ArtefactsPage } from '@/modules/artefacts/ArtefactsPage';

// ArtefactSessionCard: rendered at the top of an artefact's Chat conversation.
export { default as ArtefactSessionCard } from '@/modules/artefacts/ArtefactSessionCard';

// Shared hooks for sidebar icon tagging and Chat conversation artefact lookup.
export {
  notifyArtefactsChanged,
  useArtefactBySessionId,
  useArtefactSessionIds,
} from '@/modules/artefacts/useArtefacts';

// SpreadsheetEditor: rendered by WorkspaceMain for an opened spreadsheet. Loaded on
// demand, so FortuneSheet (and its styles) only download when a spreadsheet opens.
export const SpreadsheetEditor = lazy(() => import('@/modules/artefacts/sheet/SpreadsheetEditor'));
