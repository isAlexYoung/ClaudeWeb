import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { bindBrowserClipboard, writeLocalText } from '@/modules/graphical-panel/browserClipboard';
import { api, graphicalSocketUrl } from '@/shared/api';

type Rfb = {
  disconnect(): void;
  sendKey(keysym: number, code: string, down?: boolean): void;
  addEventListener(name: string, callback: () => void): void;
  focus(): void;
  scaleViewport: boolean;
  resizeSession: boolean;
  resizeLimits: { width: number; height: number };
  qualityLevel: number;
  compressionLevel: number;
};
type NoVncModule = {
  default: new (target: HTMLElement, url: string, options: { shared: boolean }) => Rfb;
  boundedDesktopSize(width: number, height: number): { width: number; height: number };
};
type PanelState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unavailable';

// The browser relay's progress stages.
const STAGES: Record<string, string> = {
  request: 'request', authenticated: 'authenticated', resource_check: 'resources',
  lease_ready: 'service', gui_socket: 'service', gui_worker: 'environment', x11_ready: 'desktop',
  dbus_started: 'ime', ime_ready: 'windowManager', openbox_started: 'connecting', gui_ready: 'ready',
  browser_socket: 'appService', browser_worker: 'appStarting', browser_spawned: 'appWindow',
  browser_visible: 'appShown', browser_ready: 'connecting', app_ime: 'appIme', app_visible: 'appShown',
  websocket_ready: 'firstFrame',
};
const REFUSALS = ['gui_capacity', 'browser_running', 'resource_budget', 'resource_pressure', 'telemetry_unavailable'];
const FAILURES = [
  'lease_start_timeout', 'display_start_timeout', 'application_start_timeout', 'display_exited', 'application_exited',
  'browser_closed', 'display_closed', 'lease_closed', 'disconnected_timeout', 'authentication_revoked', 'browser_moved',
  'websocket_attach_timeout', 'upgrade_aborted', 'initialization_failed',
];
// Explicit, user-initiated clipboard, as on the desktop: nothing is read or
// written in the background and nothing is stored.
const CLIP_MAX = 16384;
const IMAGE_MAX = 1000 * 1024;
const CLIP_CODES = [
  'EMPTY', 'NON_TEXT', 'TOO_LARGE', 'INVALID_UTF8', 'CONTROL_CHARACTERS', 'BUSY', 'RATE_LIMITED', 'GUI_INACTIVE',
  'UNAUTHORIZED', 'TIMEOUT', 'UNAVAILABLE', 'INVALID_REQUEST', 'LOCAL_DENIED', 'LOCAL_IMAGE_DENIED', 'NON_IMAGE',
  'UNSUPPORTED_FORMAT', 'INVALID_IMAGE', 'IMAGE_EMPTY', 'IMAGE_TOO_LARGE', 'IMAGE_RATE_LIMITED', 'FILES_UNSUPPORTED',
];
// The image endpoint shares some codes with the text one but means its own limits.
const imageError = (code: string) => new Error(['EMPTY', 'TOO_LARGE', 'RATE_LIMITED'].includes(code) ? `IMAGE_${code}` : code);

function isPng(bytes: Uint8Array) { return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value); }
function localTextProblem(text: string) {
  if (!text) return 'EMPTY';
  // A lone surrogate cannot be encoded as UTF-8 (String.prototype.isWellFormed).
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) return 'INVALID_UTF8';
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if ((point < 0x20 && point !== 9 && point !== 10 && point !== 13) || (point >= 0x7f && point <= 0x9f)) return 'CONTROL_CHARACTERS';
  }
  return new TextEncoder().encode(text).length > CLIP_MAX ? 'TOO_LARGE' : null;
}
async function replyCode(response: Response) {
  const value = await response.json().catch(() => ({}));
  return { value, code: (value?.code ?? value?.error?.code) as string | undefined };
}

/**
 * The server's Chromium, shown through the browser relay (relayed by the
 * ClaudeWeb server, so it also works without the domain). Opening it here
 * takes the browser over from the desktop window and the other way round.
 *
 * Used by the browser wrapper and ClaudeDesktop modal through WorkspaceToolsProvider, which keeps it mounted while the user is
 * elsewhere (`visible` false). Unmounting ends the browser.
 */
export function GraphicalPanel({ visible, application = 'browser' }: { visible: boolean; application?: 'browser' | 'desktop' }) {
  const { t } = useTranslation('common');
  const transport = application === 'desktop' ? api.desktop : api.browser;
  const translate = (key: string, options?: Record<string, unknown>) => t(key.replace('workspace.browser', application === 'desktop' ? 'workspace.desktop' : 'workspace.browser'), options);
  const rfbRef = useRef<Rfb | null>(null);
  const sidRef = useRef('');
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const host = useRef<HTMLDivElement>(null);
  const proxy = useRef<HTMLTextAreaElement>(null);
  // Retains graphical connection/progress and user-requested clipboard state while minimized.
  const [state, setState] = useState<PanelState>('connecting');
  // Retains graphical connection/progress and user-requested clipboard state while minimized.
  const [attempt, setAttempt] = useState(0);
  // Retains graphical connection/progress and user-requested clipboard state while minimized.
  const [stage, setStage] = useState('request');
  // Retains graphical connection/progress and user-requested clipboard state while minimized.
  const [elapsed, setElapsed] = useState(0);
  // Retains graphical connection/progress and user-requested clipboard state while minimized.
  const [failure, setFailure] = useState<string | null>(null);
  // Retains graphical connection/progress and user-requested clipboard state while minimized.
  const [clipNotice, setClipNotice] = useState<string | null>(null);
  // Retains graphical connection/progress and user-requested clipboard state while minimized.
  const [clipManual, setClipManual] = useState<string | null>(null);
  // Retains graphical connection/progress and user-requested clipboard state while minimized.
  const [imageManual, setImageManual] = useState<string | null>(null);

  const reasonText = (reason: string) => (REFUSALS.includes(reason)
    ? translate(`workspace.browser.refusals.${reason}`)
    : FAILURES.includes(reason) ? translate(`workspace.browser.failures.${reason}`) : translate('workspace.browser.ended'));
  const reasonRef = useRef(reasonText);
  reasonRef.current = reasonText;

  useEffect(() => {
    let disposed = false, finished = false, polling = false, sid = '', opened = false, reconnecting = false, reconnectStarted = 0;
    const started = performance.now();
    let rfb: Rfb | undefined;
    let wake: (() => void) | undefined, attemptDone: (() => void) | undefined;
    const wakeNow = () => wake?.();
    const wakeVisible = () => { if (!document.hidden) wake?.(); };
    window.addEventListener('online', wakeNow); window.addEventListener('focus', wakeNow); document.addEventListener('visibilitychange', wakeVisible);
    setState('connecting'); setStage('request'); setElapsed(0); setFailure(null);
    let progressAbort: AbortController | undefined;
    async function progress(final = false) {
      if (disposed || (!final && (finished || polling)) || !sid) return false;
      let reason = false;
      if (final) progressAbort?.abort();
      polling = true;
      const abort = new AbortController(); progressAbort = abort;
      const timeout = setTimeout(() => abort.abort(), 3000);
      try {
        const response = await transport.status(sid, abort.signal);
        if (response.ok) {
          const data = await response.json();
          if (disposed || abort.signal.aborted) return false;
          reason = Boolean(data.reason);
          if (data.reason) setFailure(reasonRef.current(data.reason));
          if (data.state === 'waiting_resources') setStage(REFUSALS.includes(data.reason) ? `refusal:${data.reason}` : 'waitingResources');
          else if (data.state === 'stopping') setStage('stopping');
          else if (data.stage && STAGES[data.stage]) setStage(STAGES[data.stage]);
        }
      } catch { /* The WebSocket is authoritative. */ }
      finally { clearTimeout(timeout); if (progressAbort === abort) { polling = false; progressAbort = undefined; } }
      if (!disposed) setElapsed(Math.floor((performance.now() - started) / 1000));
      return reason;
    }
    const progressTimer = setInterval(() => {
      if (!disposed && reconnecting) setElapsed(Math.floor((performance.now() - reconnectStarted) / 1000));
      else if (!disposed && !finished) setElapsed(Math.floor((performance.now() - started) / 1000));
      void progress();
    }, 1000);
    // A dropped connection is not the end of the browser: only the gateway's answer is.
    async function sessionAfterDisconnect(): Promise<'attach' | 'ended' | 'retry'> {
      progressAbort?.abort();
      const abort = new AbortController(); progressAbort = abort;
      const timeout = setTimeout(() => abort.abort(), 3000);
      try {
        const response = await transport.status(sid, abort.signal);
        if (response.status === 401) { setFailure(reasonRef.current('authentication_revoked')); return 'ended'; }
        if (!response.ok) return 'retry';
        const data = await response.json();
        if (data.reason) { setFailure(reasonRef.current(data.reason)); return 'ended'; }
        if (['detached', 'open', 'starting'].includes(data.state)) return 'attach';
        setFailure(null);
        return 'ended';
      } catch { return 'retry'; }
      finally { clearTimeout(timeout); }
    }
    void (async () => {
      try {
        const availability = await transport.available();
        const { available } = availability.ok ? await availability.json() : { available: false };
        if (disposed) return;
        if (!available) { setState('unavailable'); finished = true; return; }
        const path = `${import.meta.env.BASE_URL}novnc/core/rfb.js`;
        const module = await import(/* @vite-ignore */ path) as NoVncModule;
        if (disposed || !host.current) return;
        sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (value) => value.toString(16).padStart(2, '0')).join('');
        sidRef.current = sid;
        const box = host.current.getBoundingClientRect();
        const { width, height } = module.boundedDesktopSize(box.width, box.height);
        const url = graphicalSocketUrl(application, sid, width, height);
        if (!url) { setFailure(reasonRef.current('authentication_revoked')); setState('closed'); finished = true; return; }
        const open = () => {
          if (!host.current) return;
          const client = new module.default(host.current, url, { shared: false });
          rfb = client; rfbRef.current = client;
          client.resizeLimits = { width: 1600, height: 1000 };
          // Parked out of sight the screen has no size: do not shrink the browser to it.
          client.scaleViewport = visibleRef.current; client.resizeSession = visibleRef.current;
          client.qualityLevel = 5; client.compressionLevel = 6;
          client.addEventListener('connect', () => {
            if (!disposed && client === rfb) { if (!reconnecting) setStage('connected'); if (visibleRef.current) client.focus(); }
          });
          client.addEventListener('firstframe', () => {
            if (disposed || client !== rfb) return;
            finished = true; setState('open');
            opened = true; reconnecting = false; attemptDone?.();
          });
          client.addEventListener('disconnect', () => {
            if (disposed || client !== rfb) return;
            if (opened) { if (reconnecting) attemptDone?.(); else void reconnect(); return; }
            setState('closed');
            // The reason may be recorded a moment after the connection drops.
            void (async () => {
              for (let i = 0; i < 4 && !disposed; i++) { if (await progress(true)) break; await new Promise((resolve) => setTimeout(resolve, 1000)); }
              finished = true;
            })();
          });
          client.addEventListener('securityfailure', () => {
            if (!disposed && client === rfb) { reconnecting = false; attemptDone?.(); setState('closed'); finished = true; }
          });
        };
        const reconnect = async () => {
          reconnecting = true; reconnectStarted = performance.now(); rfbRef.current = null;
          setState('reconnecting'); setElapsed(0);
          let wait = 1000;
          while (!disposed && reconnecting) {
            const next = await sessionAfterDisconnect();
            if (disposed || !reconnecting) return;
            if (next === 'ended') { reconnecting = false; setState('closed'); finished = true; return; }
            if (next === 'attach') {
              await new Promise<void>((resolve) => {
                const watchdog = setTimeout(() => { const stuck = rfb; rfb = undefined; stuck?.disconnect(); resolve(); }, 30000);
                attemptDone = () => { clearTimeout(watchdog); attemptDone = undefined; resolve(); };
                open();
              });
              if (disposed || !reconnecting) return;
            }
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, wait);
              wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
            });
            wake = undefined;
            wait = Math.min(wait * 1.6, document.hidden ? 90000 : 15000);
          }
        };
        open();
        void progress();
      } catch { if (!disposed) { setState('closed'); finished = true; } }
    })();
    return () => {
      disposed = true; rfbRef.current = null; sidRef.current = ''; clearInterval(progressTimer); progressAbort?.abort();
      window.removeEventListener('online', wakeNow); window.removeEventListener('focus', wakeNow); document.removeEventListener('visibilitychange', wakeVisible);
      wake?.(); attemptDone?.();
      // Closed while disconnected: no connection is left to say so.
      if (sid) void transport.end(sid).catch(() => {});
      rfb?.disconnect();
    };
  }, [attempt, application, transport]);

  // Shown again: let the browser fit the panel and take the keyboard.
  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.scaleViewport = visible; rfb.resizeSession = visible;
    if (visible && state === 'open') rfb.focus();
  }, [visible, state]);

  // Session ended or replaced: drop any temporary clipboard content.
  useEffect(() => { if (state !== 'open') { setClipNotice(null); setClipManual(null); setImageManual(null); } }, [state]);
  useEffect(() => () => { if (imageManual) URL.revokeObjectURL(imageManual); }, [imageManual]);

  useEffect(() => {
    const target = host.current, input = proxy.current, rfb = rfbRef.current, sid = sidRef.current;
    if (state !== 'open' || !target || !input || !rfb || !sid) return;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && sidRef.current === sid && rfbRef.current === rfb;
    const ensure = () => { if (!current()) throw new Error('GUI_INACTIVE'); };
    const text = async (op: string, value?: string) => {
      ensure();
      const response = await transport.text({ sid, op, ...(value === undefined ? {} : { text: value }) }, abort.signal);
      const reply = await replyCode(response); ensure();
      // As on the desktop: only a code other than OK is a refusal.
      if (!response.ok || (reply.code && reply.code !== 'OK')) throw new Error(reply.code ?? 'UNAVAILABLE');
      return reply.value as { text: string };
    };
    const unbind = bindBrowserClipboard({ host: target, proxy: input, rfb,
      async copy(cut, valid) {
        setClipNotice(null); setClipManual(null); setImageManual(null);
        let value;
        try { value = await text(cut ? 'cut' : 'copy'); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== 'NON_TEXT') throw error;
          // Not text: the same PNG image read as the desktop browser.
          const response = await transport.readImage(sid, abort.signal); ensure();
          if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw error;
          const blob = await response.blob(); ensure();
          if (!valid()) return;
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); }
          catch { if (valid() && current()) { setImageManual(URL.createObjectURL(blob)); throw new Error('LOCAL_IMAGE_DENIED'); } }
          return;
        }
        ensure(); if (!valid()) return;
        try { await writeLocalText(value.text); }
        catch { if (valid() && current()) { setClipManual(value.text); throw new Error('LOCAL_DENIED'); } }
      },
      async paste(value) {
        setClipNotice(null); setClipManual(null); setImageManual(null);
        if (value.files.length) {
          // Files go through the desktop's file manager; only a single PNG image is pasted here.
          const png = value.files.length === 1 && value.files[0].type === 'image/png' ? value.files[0] : null;
          if (!png) throw new Error('FILES_UNSUPPORTED');
          if (png.size > IMAGE_MAX) throw new Error('IMAGE_TOO_LARGE');
          if (!isPng(new Uint8Array(await png.slice(0, 8).arrayBuffer()))) throw new Error('INVALID_IMAGE');
          ensure();
          const response = await transport.writeImage(sid, png, abort.signal);
          const reply = await replyCode(response); ensure();
          if (!response.ok || reply.code !== 'OK') throw imageError(reply.code ?? 'UNAVAILABLE');
        } else {
          const problem = localTextProblem(value.text);
          if (problem) throw new Error(problem);
          await text('write', value.text);
        }
        ensure();
      },
      error(error) {
        if (!current()) return;
        const code = error instanceof Error && CLIP_CODES.includes(error.message) ? error.message : 'UNAVAILABLE';
        setClipNotice(translate(`workspace.browser.clip.${code}`));
      },
    });
    return () => { unbind(); abort.abort(); };
  }, [state, attempt, t, transport]);

  const stageText = stage.startsWith('refusal:')
    ? translate(`workspace.browser.refusals.${stage.slice('refusal:'.length)}`)
    : translate(`workspace.browser.stages.${stage}`);
  const message = state === 'unavailable' ? translate('workspace.browser.unavailable')
    : state === 'connecting' ? translate('workspace.browser.waiting', { stage: stageText, seconds: elapsed })
      : state === 'reconnecting' ? translate('workspace.browser.reconnecting', { seconds: elapsed })
        : failure ?? translate('workspace.browser.ended');

  return (
    <div className="browser-panel" data-testid={application === 'desktop' ? 'desktop-panel' : 'browser-panel'} data-status={state}>
      <textarea ref={proxy} aria-label={translate('workspace.browser.clipboardInput')} tabIndex={-1} className="browser-panel-proxy" />
      {state === 'open' && (clipNotice || clipManual || imageManual) && (
        <div role="status" className="browser-panel-clip" data-testid="browser-clip-panel">
          <button type="button" onClick={() => { setClipNotice(null); setClipManual(null); setImageManual(null); rfbRef.current?.focus(); }}>
            {translate('workspace.browser.closeNotice')}
          </button>
          {clipNotice && <p>{clipNotice}</p>}
          {clipManual !== null && <textarea aria-label={translate('workspace.browser.copyText')} autoFocus readOnly value={clipManual}
            onFocus={(event) => event.currentTarget.select()} />}
          {imageManual && <img src={imageManual} alt={translate('workspace.browser.copyImage')} />}
        </div>
      )}
      <div ref={host} className="browser-panel-screen" />
      {state !== 'open' && (
        <div className="browser-panel-overlay">
          <div>
            <p role="status">{message}</p>
            {(state === 'closed' || state === 'reconnecting' || state === 'unavailable') && (
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>{translate('workspace.browser.reopen')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
