// ClaudeWeb modification: the UI can be served under a sub-path (Vite `base`, for
// example /claude/). The app addresses its server by root paths such as
// /api/..., /ws and /shell, so same-origin requests to those paths get the
// prefix here, before any module issues one. Imported first by main.tsx.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');
const ROOTS = ['/api', '/ws', '/shell', '/health'];

export function withBase(path: string): string {
  if (!BASE || !path.startsWith('/') || path === BASE || path.startsWith(BASE + '/')) return path;
  return ROOTS.some(root => path === root || path.startsWith(root + '/') || path.startsWith(root + '?'))
    ? BASE + path
    : path;
}

function rewrite(input: string): string {
  try {
    const url = new URL(input, window.location.href);
    const local = url.host === window.location.host && ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
    if (!local) return input;
    const path = withBase(url.pathname);
    if (path === url.pathname) return input;
    url.pathname = path;
    return url.toString();
  } catch {
    return input;
  }
}

if (BASE && typeof window !== 'undefined') {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') return nativeFetch(rewrite(input), init);
    if (input instanceof URL) return nativeFetch(rewrite(input.href), init);
    const url = rewrite(input.url);
    return nativeFetch(url === input.url ? input : new Request(url, input), init);
  };
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(url: string | URL, init?: EventSourceInit) { super(rewrite(String(url)), init); }
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) { super(rewrite(String(url)), protocols); }
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    return (nativeOpen as (...args: unknown[]) => void).call(this, method, rewrite(String(url)), ...rest);
  } as typeof XMLHttpRequest.prototype.open;
}
