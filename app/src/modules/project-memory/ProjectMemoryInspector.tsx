import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2, FileText, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { api } from '@/shared/api';
import { MotionSurface } from '@/shared/ui';
import type { ProjectMemoryEntry } from '@/shared/types';
import { useProjectMemory } from '@/modules/project-memory/hooks/useProjectMemory';
import { ProjectMemoryEditor } from '@/modules/project-memory/ProjectMemoryEditor';
import '@/modules/project-memory/project-memory.css';

function SourceJumpButton({ entry, sessionId, onFailure }: { entry: ProjectMemoryEntry; sessionId: string | null; onFailure: () => void }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  return <button type="button" onClick={() => {
    if (!entry.source || !entry.sourceSessionId) return;
    const detail = { parentSessionId: entry.sourceSessionId, source: entry.source };
    if (entry.sourceSessionId === sessionId) window.dispatchEvent(new CustomEvent('claudeweb:quote-jump', { detail }));
    else {
      try { sessionStorage.setItem(`claudeweb:memory-jump:${entry.sourceSessionId}`, JSON.stringify({ ...detail, expiresAt: Date.now() + 30_000 })); }
      catch { onFailure(); return; }
      navigate(`/session/${encodeURIComponent(entry.sourceSessionId)}`);
    }
  }}>{t('projectMemory.jump')}</button>;
}

/** Used by project-workspace's right inspector; file-backed entries are shared across project conversations. */
export function ProjectMemoryInspector({ projectId, projectName, sessionId, onFileOpen }: { projectId: string | null; projectName: string; sessionId: string | null; onFileOpen: (path: string) => void }) {
  const { t } = useTranslation('common');
  // Memory stays independently collapsed until requested, and resets when changing projects.
  const [open, setOpen] = useState(false);
  // Editor geometry belongs to its clicked row, independent of sidebar scrolling.
  const [editing, setEditing] = useState<{ entry: ProjectMemoryEntry; version: string; anchor: { x: number; y: number } } | null>(null);
  // Deleting requires confirming the exact entry; its original version remains captured until confirmed.
  const [deleting, setDeleting] = useState<{ entry: ProjectMemoryEntry; version: string } | null>(null);
  // Prevent duplicate deletion submissions and retain a local status/error message.
  const [busy, setBusy] = useState(false);
  // API errors are kept outside the polled snapshot so a background refresh cannot hide them.
  const [error, setError] = useState('');
  // Successful operations remain visible until the project changes or another action replaces them.
  const [notice, setNotice] = useState('');
  const collection = useProjectMemory(open ? projectId : null, true);
  useEffect(() => { setOpen(false); setEditing(null); setDeleting(null); setError(''); setNotice(''); }, [projectId]);
  return <section className="project-memory-inspector" data-open={open}>
    <button type="button" className="workspace-inspector-heading" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<h2>{t('projectMemory.title')}</h2></button>
    <MotionSurface open={open} kind="disclosure">
    <div className="project-memory-list">
      {!projectId ? <p>{t('projectMemory.chooseProject')}</p> : <>
        <div className="project-memory-list-tools"><span title={collection.data?.path}>{projectName} · CLAUDE.md</span><button type="button" title={t('projectMemory.reload')} aria-label={t('projectMemory.reload')} onClick={() => void collection.refresh()}><RotateCw size={14} /></button>{collection.data && <button type="button" title={t('projectMemory.openFile')} aria-label={t('projectMemory.openFile')} onClick={() => onFileOpen(collection.data!.path)}><FileText size={14} /></button>}</div>
        <p className="project-memory-help">{t('projectMemory.scope')}</p>
        {collection.loading && <p role="status">{t('projectMemory.loading')}</p>}
        {!collection.loading && !collection.error && !collection.data?.entries.length && <p>{t('projectMemory.empty')}</p>}
        {collection.data?.entries.map((entry, index) => <article className="project-memory-entry" key={entry.id}>
          <p>{entry.text}</p>
          <footer><span>{new Date(entry.updatedAt).toLocaleString()}</span><button type="button" aria-label={`${t('projectMemory.edit')} ${index + 1}`} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setEditing({ entry, version: collection.data!.version, anchor: { x: rect.left - 420, y: rect.bottom + 8 } }); }}><Pencil size={14} /></button><button type="button" aria-label={`${t('projectMemory.delete')} ${index + 1}`} onClick={() => { setError(''); setDeleting({ entry, version: collection.data!.version }); }}><Trash2 size={14} /></button></footer>
          {entry.source && <details><summary>{t('projectMemory.original')}</summary><p>{entry.source.text}</p>{entry.sourceSessionId && <SourceJumpButton entry={entry} sessionId={sessionId} onFailure={() => setError('MEMORY_FAILED')} />}</details>}
        </article>)}
      </>}
      {(error || collection.error) && <p role="alert">{t(`projectMemory.errors.${error || collection.error}`, { defaultValue: t('projectMemory.errors.default') })}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
    </MotionSurface>
    {editing && projectId && <ProjectMemoryEditor projectId={projectId} projectName={projectName} sessionId={sessionId || ''} entry={editing.entry} initialVersion={editing.version} anchor={editing.anchor} onClose={() => setEditing(null)} onSaved={() => { setNotice(t('projectMemory.saved')); void collection.refresh(); }} />}
    {deleting && <div role="alertdialog" aria-modal="false" aria-label={t('projectMemory.confirmDelete')} data-side-chat-surface="true" className="project-memory-delete" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !busy) setDeleting(null); }}>
      <strong>{t('projectMemory.confirmDelete')}</strong><p>{deleting.entry.text}</p><footer><button type="button" disabled={busy} onClick={() => setDeleting(null)}>{t('projectMemory.cancel')}</button><button type="button" disabled={busy} onClick={() => {
        if (!projectId || busy) return; setBusy(true);
        void collection.save(api.projectMemory.remove(projectId, deleting.entry.id, deleting.version)).then(() => { setDeleting(null); setNotice(t('projectMemory.deleted')); }).catch(error => { setError(error instanceof Error ? error.message : 'MEMORY_FAILED'); setDeleting(null); }).finally(() => setBusy(false));
      }}>{t('projectMemory.delete')}</button></footer>
    </div>}
  </section>;
}
