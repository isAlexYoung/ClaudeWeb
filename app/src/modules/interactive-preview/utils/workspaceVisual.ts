import { api } from '@/shared/api';

/** Used by the workspace visual loader to bound streamed HTML and resource reads before allocating blobs. */
export async function readPreviewBytes(response: Response, limit: number, signal: AbortSignal): Promise<Blob> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
  if (Number(response.headers.get('Content-Length')) > limit) { await response.body?.cancel(); throw new Error('preview-too-large'); }
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (blob.size > limit) throw new Error('preview-too-large');
    return blob;
  }
  const pieces: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('preview-too-large');
      pieces.push(new Uint8Array(value));
    }
    return new Blob(pieces);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Used by WorkspaceVisualPreview to inline bounded project resources without exposing auth to the frame. */
export async function loadWorkspaceVisual(projectId: string, path: string, signal: AbortSignal, prefetchedSource?: string): Promise<string> {
  const source = prefetchedSource ?? await (await readPreviewBytes(await api.readFileBlob(projectId, path, { signal }), 2_000_000, signal)).text();
  const document = new DOMParser().parseFromString(source, 'text/html');
  let total = 0;
  let count = 0;
  const directory = path.replace(/[^/\\]*$/, '').replace(/\\/g, '/');
  const resources = [...document.querySelectorAll('img[src], script[src], link[rel="stylesheet"][href]')];
  // Sequential reads keep peak memory bounded even when a page references many large images.
  for (const element of resources) {
    const attribute = element.tagName === 'LINK' ? 'href' : 'src';
    const value = element.getAttribute(attribute)?.trim() ?? '';
    if (!value || /^(?:https?:|data:|blob:|\/\/)/i.test(value)) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) continue;
    if (++count > 16) throw new Error('preview-too-large');
    let decoded = value;
    try { decoded = decodeURI(value); } catch { /* Preserve literal filenames. */ }
    const resourcePath = /^(?:[\\/]|[a-z]:[\\/])/i.test(decoded) ? decoded : directory + decoded;
    const result = await api.readFileBlob(projectId, resourcePath, { signal });
    const blob = await readPreviewBytes(result, Math.min(8_000_000, 24_000_000 - total), signal);
    total += blob.size;
    if (element.tagName === 'SCRIPT') {
      element.removeAttribute('src');
      element.textContent = (await blob.text()).replace(/<\/script/gi, '<\\/script');
    } else if (element.tagName === 'LINK') {
      const style = document.createElement('style');
      style.textContent = (await blob.text()).replace(/<\/style/gi, '<\\/style');
      element.replaceWith(style);
    } else {
      const mime = /\.svg$/i.test(decoded) ? 'image/svg+xml' : /\.png$/i.test(decoded) ? 'image/png' : /\.webp$/i.test(decoded) ? 'image/webp' : /\.gif$/i.test(decoded) ? 'image/gif' : 'image/jpeg';
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const parts: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 32768) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
      const data = `data:${mime};base64,${btoa(parts.join(''))}`;
      element.setAttribute('src', data);
      // Do not let srcset override the authenticated resource with another URL.
      element.removeAttribute('srcset');
    }
  }
  if (/\.svg$/i.test(path)) {
    const svg = document.querySelector('svg');
    if (!svg) throw new Error('Invalid SVG');
    return svg.outerHTML;
  }
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}
