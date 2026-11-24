/**
 * The whiteboard format: an Excalidraw scene file (`.excalidraw`), the same
 * JSON excalidraw.com opens. Besides full Excalidraw elements, the editor
 * accepts the simplified "skeleton" elements Excalidraw's
 * convertToExcalidrawElements understands, so Claude can add shapes, labels
 * and arrows without writing every internal field.
 */

/** Largest whiteboard the API reads or writes (pasted images live in the file). */
export const MAX_WHITEBOARD_BYTES = 10 * 1024 * 1024;

export type WhiteboardDocument = {
  type: 'excalidraw';
  version: number;
  source?: string;
  elements: Array<Record<string, unknown>>;
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

/** A new whiteboard: an empty white canvas. */
export function blankWhiteboardDocument(): WhiteboardDocument {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'claudeweb',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };
}

/** Checks the shape the editor depends on; the editor fills in everything else. */
export function validateWhiteboardDocument(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The file is not a JSON object.';
  const document = value as Record<string, unknown>;
  if (document.type !== 'excalidraw') return '"type" must be "excalidraw".';
  if (!Array.isArray(document.elements)) return '"elements" must be an array.';
  for (const [index, element] of document.elements.entries()) {
    if (!element || typeof element !== 'object' || Array.isArray(element)) return `Element ${index + 1} is not an object.`;
    if (typeof (element as Record<string, unknown>).type !== 'string') return `Element ${index + 1} needs a "type".`;
  }
  if (document.appState !== undefined && (typeof document.appState !== 'object' || document.appState === null || Array.isArray(document.appState))) {
    return '"appState" must be an object.';
  }
  if (document.files !== undefined && (typeof document.files !== 'object' || document.files === null || Array.isArray(document.files))) {
    return '"files" must be an object.';
  }
  return null;
}

/** Appended to the system prompt of a turn that edits a whiteboard. */
export function whiteboardEditingInstructions(filePath: string, title: string): string {
  return `You are editing the ClaudeWeb whiteboard "${title}". It is stored in the file ${filePath} as an Excalidraw scene.
The user sees this whiteboard in Excalidraw next to the conversation; the editor reloads the file as soon as you change it.
Make the change the user asks for by editing that file (Read it first, then Edit or Write it). Do not create other files unless the user asks for them, and reply with a short summary of what you changed.
The file must stay valid JSON:
{ "type": "excalidraw", "version": 2, "source": "claudeweb", "elements": [ ... ], "appState": { "viewBackgroundColor": "#ffffff" }, "files": {} }
To add elements, write simplified elements; the editor turns them into full Excalidraw elements when it loads the file:
- Shapes: { "type": "rectangle" | "ellipse" | "diamond", "id": "a-short-id", "x": 0, "y": 0, "width": 180, "height": 70, "backgroundColor": "#a5d8ff", "strokeColor": "#1e1e1e", "fillStyle": "solid", "label": { "text": "Start" } }
- Text: { "type": "text", "x": 0, "y": 120, "text": "A note", "fontSize": 20 }
- Arrows and lines between shapes: { "type": "arrow", "start": { "id": "a-short-id" }, "end": { "id": "another-id" }, "label": { "text": "yes" } } ("start"/"end" bind it to shapes by id; the editor draws it from the edge of one shape to the edge of the other, so leave out x, y and points). A free arrow or line uses "x", "y" and "points": [[0, 0], [120, 0]] instead.
- Frames group a section: { "type": "frame", "x": -40, "y": -40, "width": 600, "height": 400, "name": "Phase 1", "children": ["a-short-id"] }
Rules:
- Coordinates are pixels; y grows downwards. Leave 40-80px between shapes and lay diagrams out on a grid so nothing overlaps.
- Colors: strokeColor #1e1e1e; light fills #a5d8ff (blue), #b2f2bb (green), #ffec99 (yellow), #ffc9c9 (red), #d0bfff (violet), #eebefa (pink). Use "fillStyle": "solid" for filled shapes.
- Give every shape you create a unique short "id" so arrows can point at it.
- Elements that already have "version" and "versionNonce" are full Excalidraw elements drawn by the user or saved by the editor. Change them by editing their fields (x, y, width, height, text, strokeColor, backgroundColor); to remove one, delete it from the array. When you change the "text" of a full text element, also set "originalText" to the same value.
- Keep the user's existing elements unless they ask you to remove them, and keep "files" as it is (it holds pasted images).`;
}
