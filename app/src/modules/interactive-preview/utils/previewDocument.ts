// Only these version-pinned distributions can run when the user enables libraries.
// No wildcard CDN origin: an artifact cannot turn an arbitrary URL into an API client.
const LIBRARY_SOURCES = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.170.0/',
  'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js',
];

/** Used by InteractivePreview to build an opaque, network-restricted HTML document. */
export function buildPreviewDocument(source: string, channel: string, allowLibraries: boolean): string {
  const document = new DOMParser().parseFromString(source, 'text/html');
  // The host owns the base URL and policy; source documents cannot replace either.
  document.querySelectorAll('base, meta[http-equiv]').forEach(node => node.remove());
  const libraries = allowLibraries ? ` ${LIBRARY_SOURCES.join(' ')}` : '';
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; script-src 'unsafe-inline'${libraries}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src${allowLibraries ? libraries : " 'none'"}; media-src data: blob:; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`;
  document.head.prepend(policy);
  const bridge = document.createElement('script');
  // No parent objects or auth tokens cross the sandbox. The host checks BOTH source and channel.
  bridge.textContent = `(() => {
    const channel = ${JSON.stringify(channel)};
    const send = (kind, text) => parent.postMessage({type:'claudeweb-visual',channel,kind,text}, '*');
    let lastFollowUp = 0;
    Object.defineProperty(window, 'claudeWeb', {value: Object.freeze({
      followUp(text) {
        if (typeof text !== 'string' || !text.trim() || text.length > 2000 || Date.now()-lastFollowUp < 1000) return;
        lastFollowUp = Date.now(); send('follow-up', text.trim());
      }
    })});
    addEventListener('error', event => send('error', String(event.message || 'Resource failed to load').slice(0, 500)), true);
    addEventListener('unhandledrejection', event => send('error', String(event.reason?.message || event.reason || 'Script failed').slice(0, 500)));
    document.addEventListener('securitypolicyviolation', event => send('error', 'Blocked resource: ' + String(event.blockedURI).slice(0, 300)));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') send('close', ''); });
    document.addEventListener('click', event => {
      const button = event.target instanceof Element && event.target.closest('[data-claude-prompt]');
      if (button) { event.preventDefault(); window.claudeWeb.followUp(button.getAttribute('data-claude-prompt')); }
      if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault();
    });
    document.addEventListener('submit', event => event.preventDefault());
  })();`;
  policy.after(bridge);
  const style = document.createElement('style');
  style.textContent = 'html{color-scheme:light}body{margin:0;padding:16px;box-sizing:border-box;font:14px system-ui,sans-serif;color:#20201e;background:#fff}canvas,svg,img{max-width:100%}*{box-sizing:border-box}';
  bridge.after(style);
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}

/** Used by InteractivePreview to accept bounded events only from its current sandbox. */
export function readPreviewMessage(event: MessageEvent, frame: Window | null, channel: string): { kind: 'error' | 'follow-up' | 'close'; text: string } | null {
  const data: unknown = event.data;
  if (!frame || event.source !== frame || !data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (message.type !== 'claudeweb-visual' || message.channel !== channel || typeof message.text !== 'string') return null;
  if (message.kind === 'error') return { kind: 'error', text: message.text.slice(0, 500) };
  if (message.kind === 'close') return { kind: 'close', text: '' };
  if (message.kind === 'follow-up' && message.text.trim() && message.text.length <= 2000) return { kind: 'follow-up', text: message.text.trim() };
  return null;
}
