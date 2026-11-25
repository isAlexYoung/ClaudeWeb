import type { WhiteboardDocument } from '@/shared/types';
import { prepareScene } from '@/modules/artefacts/whiteboard/whiteboardScene';
import type { SceneConverters } from '@/modules/artefacts/whiteboard/whiteboardScene';

/**
 * Renders a whiteboard file to an image without opening the editor, for the
 * download menus. Excalidraw (and its fonts) load only when an image is made.
 */

const EXPORT_PADDING = 24;

/** A whiteboard file read from disk: an Excalidraw scene, or null when it is not one. */
export function parseWhiteboardFile(text: string): WhiteboardDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const scene = parsed as Partial<WhiteboardDocument>;
  if (scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) return null;
  if (!scene.elements.every((element) => element && typeof element === 'object' && typeof (element as { type?: unknown }).type === 'string')) return null;
  return {
    type: 'excalidraw',
    version: typeof scene.version === 'number' ? scene.version : 2,
    source: 'claudeweb',
    elements: scene.elements,
    // Only the background belongs to the drawing; the rest of an exported appState is one person's view of it.
    appState: typeof scene.appState?.viewBackgroundColor === 'string' ? { viewBackgroundColor: scene.appState.viewBackgroundColor } : {},
    files: scene.files && typeof scene.files === 'object' ? scene.files : {},
  } as WhiteboardDocument;
}

async function exportScene(document: WhiteboardDocument) {
  // Points Excalidraw at ClaudeWeb's copy of its fonts before it loads.
  await import('@/modules/artefacts/whiteboard/assetPath');
  const excalidraw = await import('@excalidraw/excalidraw');
  const converters: SceneConverters<unknown> = {
    convert: (skeletons, options) => excalidraw.convertToExcalidrawElements(skeletons as never, options),
    restore: (elements) => excalidraw.restoreElements(elements as never, null, { refreshDimensions: false, repairBindings: true }),
  };
  const scene = prepareScene(document, converters);
  return {
    excalidraw,
    options: {
      elements: scene.elements as never,
      appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false } as never,
      files: scene.files as never,
      exportPadding: EXPORT_PADDING,
    },
  };
}

export async function whiteboardToPng(document: WhiteboardDocument): Promise<Blob> {
  const { excalidraw, options } = await exportScene(document);
  return excalidraw.exportToBlob({ ...options, mimeType: 'image/png' });
}

export async function whiteboardToSvg(document: WhiteboardDocument): Promise<Blob> {
  const { excalidraw, options } = await exportScene(document);
  const svg = await excalidraw.exportToSvg(options);
  return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
}
