import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { InteractivePreview } from '@/modules/interactive-preview/InteractivePreview';
import { loadWorkspaceVisual } from '@/modules/interactive-preview/utils/workspaceVisual';

type WorkspaceVisualPreviewProps = {
  projectId: string;
  path: string;
  revision?: string;
  source?: string;
  onFollowUp?: (text: string) => void;
};

/** Used by chat and code-editor to reopen HTML/SVG and resolve authenticated project resources. */
export function WorkspaceVisualPreview({ projectId, path, revision = '', source, onFollowUp }: WorkspaceVisualPreviewProps) {
  const { t } = useTranslation('chat');
  const container = useRef<HTMLDivElement>(null);
  // Do not fetch historical deliverables until their card is near the viewport.
  const [requested, setRequested] = useState(() => typeof IntersectionObserver === 'undefined');
  // A manual refresh re-reads the file, including edits made outside the current chat.
  const [refresh, setRefresh] = useState(0);
  // Key the result to its request so an old project's response cannot flash in a new conversation.
  const [result, setResult] = useState<{ key: string; source?: string; error?: string } | null>(null);
  const key = `${projectId}:${path}:${revision}:${refresh}`;

  useEffect(() => {
    if (!container.current) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setRequested(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    void loadWorkspaceVisual(projectId, path, controller.signal, refresh === 0 ? source : undefined).then(source => {
      if (!controller.signal.aborted) setResult({ key, source });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, [projectId, path, key, requested, refresh, source]);

  const current = result?.key === key ? result : null;
  const name = path.split(/[\\/]/).pop() || path;
  return <div ref={container} className="not-prose w-full" aria-label={t('visual.filePreview', { name })}>
    <div className="flex items-center justify-end"><button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={() => { setRequested(true); setRefresh(value => value + 1); }}><RefreshCw size={13} />{t('visual.reloadFile')}</button></div>
    {current?.source !== undefined ? <InteractivePreview key={key} source={current.source} title={name} filename={name} onFollowUp={onFollowUp} />
      : current?.error ? <p role="status" className="rounded-lg border border-border p-3 text-sm text-destructive">{t(current.error === 'preview-too-large' ? 'visual.tooLarge' : 'visual.fileError', { message: current.error })}</p>
      : <div className="flex h-[240px] items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">{t(requested ? 'visual.loading' : 'visual.paused')}</div>}
  </div>;
}
