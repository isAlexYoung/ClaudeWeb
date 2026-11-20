import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { ProjectMemoryEntry, TextQuote } from '@/shared/types';
import { useProjectMemory } from '@/modules/project-memory/hooks/useProjectMemory';
import '@/modules/project-memory/project-memory.css';

type Props = { projectId: string; projectName: string; sessionId: string; source?: TextQuote; entry?: ProjectMemoryEntry; initialVersion?: string; anchor: { x: number; y: number }; onClose: () => void; onSaved?: () => void };

/** Used by the selection toolbar and memory inspector for one explicit project-file write. */
export function ProjectMemoryEditor({ projectId, projectName, sessionId, source, entry, initialVersion, anchor, onClose, onSaved }: Props) {
  const { t } = useTranslation('common');
  const collection = useProjectMemory(projectId, false);
  const label = useId();
  const ref = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
  // An edit starts from the row's version, even if the initial fetch already sees a newer file.
  const version = useRef(initialVersion || '');
  const submitting = useRef(false);
  // The editable instruction is separate from its immutable original quotation.
  const [text, setText] = useState(entry?.text || source?.text || '');
  // Geometry is re-clamped when the keyboard or viewport changes; main transcript scrolling cannot move it.
  const [position, setPosition] = useState({ left: 8, top: 8, maxWidth: window.innerWidth - 16, maxHeight: window.innerHeight - 16 });
  // Errors preserve the draft and offer an explicit refresh for conflicting file versions.
  const [error, setError] = useState('');
  // Saving locks the action buttons until the single request settles.
  const [busy, setBusy] = useState(false);
  // After an explicit reload, show the latest file text without replacing the user's draft.
  const [currentText, setCurrentText] = useState<string | null>(null);
  useEffect(() => { if (!version.current && collection.data) version.current = collection.data.version; }, [collection.data]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useLayoutEffect(() => {
    const place = () => {
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft || 0) + 8, top = (viewport?.offsetTop || 0) + 8;
      const width = (viewport?.width || window.innerWidth) - 16, height = (viewport?.height || window.innerHeight) - 16;
      const bounds = ref.current?.getBoundingClientRect();
      setPosition({ maxWidth: width, maxHeight: height, left: Math.max(left, Math.min(anchor.x, left + width - (bounds?.width || 460))), top: Math.max(top, Math.min(anchor.y, top + height - (bounds?.height || 340))) });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener('resize', place); window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); };
  }, [anchor.x, anchor.y]);
  const save = async () => {
    if (submitting.current || !text.trim() || !version.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      await collection.save(entry ? api.projectMemory.update(projectId, entry.id, { text, version: version.current })
        : api.projectMemory.create(projectId, { text, source, sessionId, version: version.current }));
      onSaved?.(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'MEMORY_FAILED'); }
    finally { submitting.current = false; setBusy(false); }
  };
  const message = error || collection.error;
  return createPortal(<div ref={ref} role="dialog" aria-modal="false" aria-labelledby={label} data-side-chat-surface="true" className="project-memory-editor" style={position}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !busy) onClose(); }}>
    <header><Bookmark size={18} /><h3 id={label}>{t(entry ? 'projectMemory.edit' : 'projectMemory.write')}</h3><button type="button" disabled={busy} aria-label={t('projectMemory.close')} onClick={onClose}><X size={18} /></button></header>
    <p className="project-memory-target" title={collection.data?.path}>{t('projectMemory.project', { name: projectName })} · CLAUDE.md</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor={`${label}-input`}>{t('projectMemory.content')}</label>
      <textarea id={`${label}-input`} ref={inputRef} value={text} maxLength={20_000} rows={4} onChange={event => setText(event.target.value)} />
      <p className="project-memory-help">{t('projectMemory.activation')}</p>
      {currentText !== null && <details open><summary>{t('projectMemory.currentFileText')}</summary><p className="project-memory-current">{currentText || t('projectMemory.entryRemoved')}</p></details>}
      {message && <p role="alert" className="project-memory-error">{t(`projectMemory.errors.${message}`, { defaultValue: t('projectMemory.errors.default') })}</p>}
      {message && <button type="button" className="project-memory-reload" disabled={busy} onClick={() => { void collection.refresh().then(data => { if (data) { version.current = data.version; setError(''); if (entry) setCurrentText(data.entries.find(item => item.id === entry.id)?.text || ''); } }); }}>{t('projectMemory.reload')}</button>}
      <footer><button type="button" disabled={busy} onClick={onClose}>{t('projectMemory.cancel')}</button><button type="submit" disabled={busy || collection.loading || !collection.data || !text.trim()}>{t(busy ? 'projectMemory.saving' : 'projectMemory.save')}</button></footer>
    </form>
  </div>, document.body);
}
