// Imported by WhiteboardEditor before Excalidraw itself: Excalidraw reads
// window.EXCALIDRAW_ASSET_PATH when it registers its fonts. ClaudeWeb serves
// them at <base>/excalidraw-assets/fonts/ (see the excalidrawAssets plugin in
// vite.config.js), so whiteboards never depend on the esm.sh CDN.

type ExcalidrawWindow = Window & { EXCALIDRAW_ASSET_PATH?: string | string[] };

if (typeof window !== 'undefined') {
  const target = window as ExcalidrawWindow;
  if (!target.EXCALIDRAW_ASSET_PATH) {
    const base = import.meta.env.BASE_URL || '/';
    target.EXCALIDRAW_ASSET_PATH = new URL(`${base.replace(/\/?$/, '/')}excalidraw-assets/`, window.location.origin).href;
  }
}

export {};
