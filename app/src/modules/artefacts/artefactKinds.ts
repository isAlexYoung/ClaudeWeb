import { ChartColumnBig, Component, File, Palette, Presentation, Shapes, Sheet, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ArtefactKind } from '@/shared/types';

/** How the Artefacts page shows one kind of artefact. */
export type ArtefactKindDefinition = {
  kind: ArtefactKind;
  icon: LucideIcon;
  /** Shown as a "Beta" badge on its tile and in the New menu. */
  beta?: boolean;
  /** False for the kinds that only have their picture so far. */
  available: boolean;
  /** Offered as a "Create new" tile; the filter also lists kinds that are not. */
  creatable: boolean;
};

/** Every kind, in the order the tiles, New menu and filter show them. */
export const ARTEFACT_KINDS: ArtefactKindDefinition[] = [
  { kind: 'doc', icon: File, available: false, creatable: true },
  { kind: 'slides', icon: Presentation, available: false, creatable: true },
  { kind: 'sheet', icon: Sheet, beta: true, available: true, creatable: true },
  { kind: 'design', icon: Palette, available: false, creatable: true },
  { kind: 'design-system', icon: Component, available: false, creatable: false },
  { kind: 'data', icon: ChartColumnBig, available: false, creatable: true },
  { kind: 'whiteboard', icon: Shapes, beta: true, available: false, creatable: true },
  { kind: 'other', icon: Sparkles, available: false, creatable: false },
];

export const CREATABLE_KINDS = ARTEFACT_KINDS.filter((definition) => definition.creatable);

const BY_KIND = new Map(ARTEFACT_KINDS.map((definition) => [definition.kind, definition]));

/** The definition for a kind; unknown kinds read as "other". */
export function artefactKind(kind: string): ArtefactKindDefinition {
  return BY_KIND.get(kind as ArtefactKind) ?? BY_KIND.get('other')!;
}
