import type { WhiteboardDocument } from '@/shared/types';

/**
 * Converts between the whiteboard file (an Excalidraw scene that may hold
 * Claude's simplified "skeleton" elements) and what Excalidraw renders. The
 * Excalidraw functions are passed in, so this module stays free of the large
 * library and can be tested on its own.
 */

type SceneElement = Record<string, unknown>;

/** The Excalidraw helpers the conversion needs (from @excalidraw/excalidraw). */
export type SceneConverters<E> = {
  /** convertToExcalidrawElements: skeletons → full elements. */
  convert: (skeletons: SceneElement[], options: { regenerateIds: boolean }) => E[];
  /** restoreElements: fills in missing fields and repairs bindings. */
  restore: (elements: unknown[]) => E[];
};

/** The scene Excalidraw is given: its elements, background and pasted images. */
export type PreparedScene<E> = {
  elements: E[];
  appState: { viewBackgroundColor: string };
  files: Record<string, unknown>;
};

const DEFAULT_BACKGROUND = '#ffffff';

/**
 * A full Excalidraw element (drawn by the user or saved by the editor) rather
 * than a skeleton Claude wrote: full elements always carry their version pair.
 */
export function isFullElement(element: SceneElement): boolean {
  return typeof element.version === 'number' && typeof element.versionNonce === 'number' && typeof element.id === 'string';
}

/** Splits a file's elements into full ones and skeletons, keeping each group's order. */
export function splitElements(elements: SceneElement[]): { full: SceneElement[]; skeletons: SceneElement[] } {
  const full: SceneElement[] = [];
  const skeletons: SceneElement[] = [];
  for (const element of elements) (isFullElement(element) ? full : skeletons).push(element);
  return { full, skeletons };
}

type Box = { x: number; y: number; width: number; height: number; type: string };

const ARROW_GAP = 6;
/** The size Excalidraw gives a skeleton shape that has none. */
const DEFAULT_SHAPE_SIZE = 100;

function boxOf(element: SceneElement | undefined): Box | null {
  if (!element) return null;
  const { x, y, type } = element;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  const width = typeof element.width === 'number' ? element.width : DEFAULT_SHAPE_SIZE;
  const height = typeof element.height === 'number' ? element.height : DEFAULT_SHAPE_SIZE;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height, type: typeof type === 'string' ? type : 'rectangle' };
}

/** Where the line from a shape's centre towards `toward` leaves the shape's outline. */
function edgePoint(box: Box, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const a = box.width / 2;
  const b = box.height / 2;
  let t: number;
  if (box.type === 'ellipse') t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  else if (box.type === 'diamond') t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else t = Math.min(dx === 0 ? Infinity : a / Math.abs(dx), dy === 0 ? Infinity : b / Math.abs(dy));
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Excalidraw only records which shapes a skeleton arrow is bound to; where it
 * is drawn comes from its own x, y and points (100px to the right by
 * default). An arrow or line Claude joined to two shapes by id, without points
 * of its own, is drawn from the edge of one shape to the edge of the other.
 */
export function routeSkeletonArrows(elements: SceneElement[]): SceneElement[] {
  const byId = new Map<string, SceneElement>();
  for (const element of elements) if (typeof element.id === 'string') byId.set(element.id, element);
  return elements.map((element) => {
    if ((element.type !== 'arrow' && element.type !== 'line') || isFullElement(element) || Array.isArray(element.points)) return element;
    const startId = (element.start as { id?: unknown } | undefined)?.id;
    const endId = (element.end as { id?: unknown } | undefined)?.id;
    const from = typeof startId === 'string' ? boxOf(byId.get(startId)) : null;
    const to = typeof endId === 'string' ? boxOf(byId.get(endId)) : null;
    if (!from || !to) {
      // Claude is told to leave out x and y; without both ends it still needs somewhere to start.
      if (typeof element.x === 'number' && typeof element.y === 'number') return element;
      return { ...element, x: from ? from.x + from.width : 0, y: from ? from.y + from.height / 2 : 0 };
    }
    const fromCentre = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toCentre = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const start = edgePoint(from, toCentre);
    const end = edgePoint(to, fromCentre);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    // Shapes that touch or overlap get no gap, so the arrow keeps its direction.
    const gap = length > ARROW_GAP * 3 ? ARROW_GAP : 0;
    const ux = length > 0 ? (end.x - start.x) / length : 0;
    const uy = length > 0 ? (end.y - start.y) / length : 0;
    const sx = start.x + ux * gap;
    const sy = start.y + uy * gap;
    const ex = end.x - ux * gap;
    const ey = end.y - uy * gap;
    return { ...element, x: sx, y: sy, width: Math.abs(ex - sx), height: Math.abs(ey - sy), points: [[0, 0], [ex - sx, ey - sy]] };
  });
}

/**
 * Excalidraw puts an arrow bound to a frame's child into that frame, which
 * clips it at the frame's border. An arrow (with its label) that leads out of
 * the frame is taken out of it again, so it is drawn whole.
 */
export function releaseCrossingArrows(elements: SceneElement[]): SceneElement[] {
  const frameOf = new Map<string, unknown>();
  for (const element of elements) if (typeof element.id === 'string') frameOf.set(element.id, element.frameId ?? null);
  const released = new Set<string>();
  const result = elements.map((element) => {
    if (!element.frameId || (element.type !== 'arrow' && element.type !== 'line')) return element;
    const ends = [
      (element.startBinding as { elementId?: unknown } | null | undefined)?.elementId,
      (element.endBinding as { elementId?: unknown } | null | undefined)?.elementId,
    ].filter((id): id is string => typeof id === 'string');
    if (ends.every((id) => frameOf.get(id) === element.frameId)) return element;
    if (typeof element.id === 'string') released.add(element.id);
    return { ...element, frameId: null };
  });
  if (released.size === 0) return result;
  return result.map((element) => (
    typeof element.containerId === 'string' && released.has(element.containerId) ? { ...element, frameId: null } : element
  ));
}

/**
 * The scene to show for a file. Skeletons are converted together (so arrows
 * can bind to shapes by the ids Claude gave them) and drawn above the full
 * elements; then everything is restored, which fills any field still missing.
 */
export function prepareScene<E>(document: WhiteboardDocument, converters: SceneConverters<E>): PreparedScene<E> {
  const { full, skeletons: rawSkeletons } = splitElements(Array.isArray(document.elements) ? document.elements : []);
  // Arrows may join skeletons and shapes already on the board; both are looked up by id.
  const skeletons = routeSkeletonArrows([...full, ...rawSkeletons]).slice(full.length);
  let converted: E[] = [];
  if (skeletons.length > 0) {
    try {
      converted = converters.convert(skeletons, { regenerateIds: false });
    } catch {
      // One malformed skeleton must not lose the whole board: convert them one by one.
      converted = skeletons.flatMap((skeleton) => {
        try {
          return converters.convert([skeleton], { regenerateIds: false });
        } catch {
          return [];
        }
      });
    }
    converted = releaseCrossingArrows(converted as unknown as SceneElement[]) as unknown as E[];
  }
  const background = typeof document.appState?.viewBackgroundColor === 'string'
    ? document.appState.viewBackgroundColor
    : DEFAULT_BACKGROUND;
  return {
    elements: converters.restore([...full, ...converted]),
    appState: { viewBackgroundColor: background },
    files: document.files && typeof document.files === 'object' ? { ...document.files } : {},
  };
}

/**
 * The file for what the board shows now: deleted elements are dropped, and
 * only the pasted images still on the board are kept.
 */
export function toSceneFile(
  elements: readonly SceneElement[],
  appState: { viewBackgroundColor?: string },
  files: Record<string, unknown>,
): WhiteboardDocument {
  const live = elements.filter((element) => !element.isDeleted).map((element) => ({ ...element }));
  const usedFiles = new Set(live.map((element) => element.fileId).filter((id): id is string => typeof id === 'string'));
  const keptFiles: Record<string, unknown> = {};
  for (const [id, file] of Object.entries(files)) if (usedFiles.has(id)) keptFiles[id] = file;
  return {
    type: 'excalidraw',
    version: 2,
    source: 'claudeweb',
    elements: live,
    appState: { viewBackgroundColor: appState.viewBackgroundColor ?? DEFAULT_BACKGROUND },
    files: keptFiles,
  };
}

/** Excalidraw's language for the interface language. */
export function whiteboardLanguage(language: string): string {
  if (/^zh-(tw|hk|hant)/i.test(language)) return 'zh-TW';
  if (/^zh/i.test(language)) return 'zh-CN';
  return 'en';
}
