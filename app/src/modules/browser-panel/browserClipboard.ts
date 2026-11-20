// The same gesture-only clipboard bridge as WebDesktop's browser window
// (src/components/desktop/gui-clipboard.mjs), without the desktop's file
// selection: no polling, history or automatic clipboard reads on focus.

export type RemoteKeys = {
  focus(): void;
  sendKey(keysym: number, code: string, down?: boolean): void;
};

type Valid = () => boolean;

type BindOptions = {
  host: HTMLElement;
  proxy: HTMLTextAreaElement;
  rfb: RemoteKeys;
  copy: (cut: boolean, valid: Valid) => Promise<void>;
  paste: (value: { text: string; files: File[] }, valid: Valid) => Promise<void>;
  error: (error: unknown) => void;
};

export async function writeLocalText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* HTTP / permission fallback, gesture only. */ }
  const previous = document.activeElement as HTMLElement | null;
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('aria-label', 'Clipboard');
  input.style.cssText = 'position:fixed;left:-10000px;top:0';
  document.body.append(input);
  input.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } finally { input.remove(); previous?.focus?.({ preventScroll: true }); }
  if (!copied) throw new Error('LOCAL_DENIED');
}

export function bindBrowserClipboard({ host, proxy, rfb, copy, paste, error }: BindOptions): () => void {
  let disposed = false, busy = false, waiting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const held = new Map<string, string>();
  const valid = () => !disposed;
  const releaseModifiers = () => {
    // Clear noVNC's own pressed-key bookkeeping as well as its remote state.
    const canvas = host.querySelector('canvas');
    for (const [key, code] of [['Control', 'ControlLeft'], ['Control', 'ControlRight'], ['Meta', 'MetaLeft'], ['Meta', 'MetaRight']]) {
      canvas?.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }));
    }
  };
  const restoreModifiers = () => {
    if (!host.contains(document.activeElement)) return;
    const canvas = host.querySelector('canvas');
    for (const [code, key] of held) canvas?.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
  };
  const run = async (fn: (valid: Valid) => Promise<void>) => {
    if (disposed || busy) return;
    busy = true;
    try { await fn(valid); } catch (caught) { if (!disposed) error(caught); } finally { busy = false; }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.isTrusted && ['Control', 'Meta'].includes(event.key)) held.set(event.code, event.key);
    if (!event.isTrusted || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (!['c', 'x', 'v'].includes(key)) return;
    event.stopImmediatePropagation();
    if (event.repeat || busy || waiting) { event.preventDefault(); return; }
    if (key === 'v') {
      // Keep the browser's default action: it delivers clipboardData even on
      // HTTP. noVNC must not consume the key before the paste event occurs.
      waiting = true; proxy.value = ''; proxy.focus({ preventScroll: true });
      timer = setTimeout(() => {
        if (!waiting || disposed) return;
        waiting = false; releaseModifiers(); rfb.focus(); error(new Error('LOCAL_DENIED'));
      }, 1500);
    } else {
      event.preventDefault();
      releaseModifiers();
      void run((check) => copy(key === 'x', check)).finally(() => { if (!disposed) restoreModifiers(); });
    }
  };
  const pasted = (event: ClipboardEvent) => {
    if (!event.isTrusted || disposed) return;
    event.preventDefault(); event.stopImmediatePropagation();
    waiting = false; clearTimeout(timer); releaseModifiers();
    // DataTransfer is only readable synchronously during the trusted event.
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const files = Array.from(event.clipboardData?.files ?? []);
    void run(async (check) => {
      await paste({ text, files }, check);
      if (!check()) return;
      rfb.focus();
      rfb.sendKey(0xffe3, 'ControlLeft', true);
      try { rfb.sendKey(0x76, 'KeyV'); } finally { rfb.sendKey(0xffe3, 'ControlLeft', false); }
    }).finally(() => { if (!disposed) { rfb.focus(); restoreModifiers(); } });
  };
  const keyup = (event: KeyboardEvent) => {
    if (!event.isTrusted) return;
    if (['Control', 'Meta'].includes(event.key)) { held.delete(event.code); if (event.currentTarget === proxy) releaseModifiers(); }
  };
  const blur = () => held.clear();
  host.addEventListener('keydown', keydown, true);
  host.addEventListener('keyup', keyup, true);
  host.addEventListener('paste', pasted, true);
  proxy.addEventListener('paste', pasted);
  proxy.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
  return () => {
    disposed = true; clearTimeout(timer);
    host.removeEventListener('keydown', keydown, true);
    host.removeEventListener('keyup', keyup, true);
    host.removeEventListener('paste', pasted, true);
    proxy.removeEventListener('paste', pasted);
    proxy.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur); held.clear();
    proxy.value = '';
  };
}
