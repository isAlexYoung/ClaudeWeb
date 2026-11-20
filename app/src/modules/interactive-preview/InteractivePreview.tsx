import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Code2, Download, Maximize2, Minimize2, Play, RefreshCw, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { buildPreviewDocument, readPreviewMessage } from '@/modules/interactive-preview/utils/previewDocument';
import { pickFileDownload } from '@/shared/utils';

type InteractivePreviewProps = {
  source: string;
  title: string;
  filename?: string;
  onFollowUp?: (text: string) => void;
};

/** Used by chat and code-editor to run HTML/SVG, Canvas and WebGL in an isolated preview. */
export function InteractivePreview({ source, title, filename = 'visual.html', onFollowUp }: InteractivePreviewProps) {
  const { t } = useTranslation('chat');
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const instanceId = useId();
  const lastFollowUp = useRef(0);
  // Each run has its own identity, so an old frame cannot send events into a replacement.
  const [revision, setRevision] = useState(0);
  // Explicit stop/source view tears down the frame and releases its animation/GPU resources.
  const [running, setRunning] = useState(true);
  // Offscreen and background previews must not keep executing JavaScript.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [foreground, setForeground] = useState(() => document.visibilityState !== 'hidden');
  // Fullscreen stays within the app, including on mobile browsers without Fullscreen API support.
  const [expanded, setExpanded] = useState(false);
  // Source is a passive alternative to running the preview, not an editor for the original file.
  const [showSource, setShowSource] = useState(false);
  // External libraries stay disabled until the user chooses to load the pinned distributions.
  const [allowLibraries, setAllowLibraries] = useState(false);
  // Runtime errors are surfaced outside the sandbox so a broken page can be restarted.
  const [runtimeError, setRuntimeError] = useState('');
  // A frame may propose a prompt, but only an explicit host button can put it in the composer.
  const [followUp, setFollowUp] = useState('');
  const contentVersion = useMemo(() => {
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return hash.toString(36);
  }, [source]);
  const channel = [instanceId, contentVersion, revision, allowLibraries, expanded, visible, foreground, running, showSource].join(':');
  const documentSource = useMemo(() => buildPreviewDocument(source, channel, allowLibraries), [source, channel, allowLibraries]);
  const active = running && !showSource && foreground && (visible || expanded);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '120px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);

  useEffect(() => {
    const update = () => setForeground(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = readPreviewMessage(event, frame.current?.contentWindow ?? null, channel);
      if (!message) return;
      if (message.kind === 'error') setRuntimeError(message.text);
      else if (message.kind === 'close') setExpanded(false);
      else if (Date.now() - lastFollowUp.current > 1000) { lastFollowUp.current = Date.now(); setFollowUp(message.text); }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel]);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key === 'Tab') {
        const buttons = container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, iframe');
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    container.current?.querySelector('button')?.focus();
    window.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', keyboard); if (previous instanceof HTMLElement) previous.focus(); };
  }, [expanded]);

  const restart = () => { setRuntimeError(''); setFollowUp(''); setRunning(true); setShowSource(false); setRevision(value => value + 1); };
  const download = async () => {
    try {
      const destination = await pickFileDownload(filename);
      if (destination) await destination.save(new Blob([source], { type: /\.svg$/i.test(filename) ? 'image/svg+xml' : 'text/html' }));
    } catch (error) { setRuntimeError(error instanceof Error ? error.message : String(error)); }
  };
  const buttonClass = 'inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  const content = (
    <div ref={container} className={`not-prose flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground ${expanded ? 'fixed inset-3 z-[10000] shadow-2xl sm:inset-6' : 'my-3 w-full'}`}
      role={expanded ? 'dialog' : 'region'} aria-modal={expanded || undefined} aria-label={title}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <span className="mr-auto max-w-[60%] truncate text-sm font-medium" title={title}>{title}</span>
        <button type="button" className={buttonClass} onClick={() => { setRunning(value => !value); setShowSource(false); }} aria-label={t(running ? 'visual.stop' : 'visual.run')} title={t(running ? 'visual.stop' : 'visual.run')}>{running ? <Square size={15} /> : <Play size={15} />}</button>
        <button type="button" className={buttonClass} onClick={restart} aria-label={t('visual.refresh')} title={t('visual.refresh')}><RefreshCw size={15} /></button>
        <button type="button" className={buttonClass} onClick={() => setShowSource(value => !value)} aria-pressed={showSource} aria-label={t('visual.source')} title={t('visual.source')}><Code2 size={15} /></button>
        <button type="button" className={buttonClass} onClick={download} aria-label={t('visual.download')} title={t('visual.download')}><Download size={15} /></button>
        <button type="button" className={buttonClass} onClick={() => setExpanded(value => !value)} aria-label={t(expanded ? 'visual.exitFullscreen' : 'visual.fullscreen')} title={t(expanded ? 'visual.exitFullscreen' : 'visual.fullscreen')}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>
      <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground"><input type="checkbox" checked={allowLibraries} onChange={event => { setAllowLibraries(event.target.checked); setRuntimeError(''); }} />{t('visual.libraries')}</label>
      {showSource ? <pre className="m-0 max-h-[600px] overflow-auto whitespace-pre-wrap break-words p-4 text-xs">{source}</pre>
        : active ? <iframe key={channel} ref={frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={documentSource} className={`w-full border-0 bg-white ${expanded ? 'min-h-0 flex-1' : 'h-[420px] sm:h-[480px]'}`} />
        : <div className={`flex items-center justify-center p-6 text-sm text-muted-foreground ${expanded ? 'flex-1' : 'h-[420px] sm:h-[480px]'}`}>{t(running ? 'visual.paused' : 'visual.stopped')}</div>}
      {runtimeError && <p role="status" className="m-0 border-t border-border px-3 py-2 text-xs text-destructive">{t('visual.error', { message: runtimeError })}</p>}
      {followUp && onFollowUp && <div className="flex flex-wrap items-center gap-2 border-t border-border p-3"><p className="m-0 min-w-0 flex-1 break-words text-sm">{followUp}</p><button type="button" className={buttonClass} onClick={() => { onFollowUp(followUp); setFollowUp(''); }}>{t('visual.usePrompt')}</button><button type="button" className={buttonClass} onClick={() => setFollowUp('')}>{t('visual.dismiss')}</button></div>}
    </div>
  );
  return expanded ? <>{createPortal(<div className="fixed inset-0 z-[9999] bg-black/40">{content}</div>, document.body)}<div className="my-3 h-[480px]" /></> : content;
}
