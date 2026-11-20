import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveRestore, Folder, MessageCircle, Trash2 } from 'lucide-react';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import { api } from '@/shared/api';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import type { ArchivedProjectListItem, ArchivedSessionListItem } from '@/shared/types';

// What the delete confirmation is about: one session, or a project with all its sessions.
type PendingDelete =
  | { kind: 'session'; id: string; title: string }
  | { kind: 'project'; id: string; title: string };

type ArchiveState = {
  projects: ArchivedProjectListItem[];
  sessions: ArchivedSessionListItem[];
  loading: boolean;
  error: string | null;
};

/**
 * Rendered by the "tasks and sessions" settings tab: the archive, which the
 * sidebar no longer shows. Sessions and projects can be restored or deleted
 * for good; deleting a project removes its sessions and their transcripts but
 * never the project folder itself. `onChanged` lets the sidebar refresh after
 * a restore or delete.
 */
export default function ArchivedSessionsSection({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation('settings');
  // Archived rows and load errors belong to this settings page, not the active sidebar list.
  const [state, setState] = useState<ArchiveState>({ projects: [], sessions: [], loading: true, error: null });
  // Serialize mutations so a slower refresh cannot resurrect a row another operation removed.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Deleting conversation data requires a separate confirmation; opening it does not mutate anything.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const load = useCallback(async () => {
    try {
      const [projectsResponse, sessionsResponse] = await Promise.all([api.archivedProjects(), api.getArchivedSessions()]);
      if (!projectsResponse.ok || !sessionsResponse.ok) throw new Error(t('archive.loadFailed'));
      const projectsPayload = await projectsResponse.json() as { data?: { projects?: ArchivedProjectListItem[] } };
      const sessionsPayload = await sessionsResponse.json() as { data?: { sessions?: ArchivedSessionListItem[] } };
      const projects = Array.isArray(projectsPayload.data?.projects) ? projectsPayload.data.projects : [];
      const archivedProjectIds = new Set(projects.map((project) => project.projectId));
      // A session of an archived project comes back with its project.
      const sessions = (Array.isArray(sessionsPayload.data?.sessions) ? sessionsPayload.data.sessions : [])
        .filter((session) => !session.projectId || !archivedProjectIds.has(session.projectId));
      setState({ projects, sessions, loading: false, error: null });
    } catch (error) {
      setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const run = async (id: string, action: () => Promise<Response>, failure: string) => {
    setBusyId(id);
    try {
      const response = await action();
      if (!response.ok) throw new Error(failure);
      await load();
      onChanged?.();
    } catch (error) {
      setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : failure }));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    void run(
      target.id,
      () => (target.kind === 'project' ? api.deleteProject(target.id, true) : api.deleteSession(target.id, true)),
      t('archive.deleteFailed'),
    );
  };

  const empty = !state.loading && !state.error && !state.projects.length && !state.sessions.length;

  return (
    <SettingsSection title={t('archive.title')} description={t('archive.description')}>
      <SettingsCard className="settings-archive">
        {state.loading && <p className="settings-archive-note">{t('archive.loading')}</p>}
        {state.error && <p className="settings-archive-note" role="status">{state.error}</p>}
        {empty && <p className="settings-archive-note">{t('archive.empty')}</p>}
        {state.projects.map((project) => (
          <div className="settings-archive-row" key={`project-${project.projectId}`}>
            <Folder size={16} />
            <span>{project.displayName}<small>{t('archive.project')}</small></span>
            <button type="button" disabled={busyId !== null}
              onClick={() => void run(project.projectId, () => api.restoreProject(project.projectId), t('archive.restoreFailed'))}>
              <ArchiveRestore size={15} />{t('archive.restore')}
            </button>
            <button type="button" className="danger" disabled={busyId !== null}
              onClick={() => setPendingDelete({ kind: 'project', id: project.projectId, title: project.displayName })}>
              <Trash2 size={15} />{t('archive.delete')}
            </button>
          </div>
        ))}
        {state.sessions.map((session) => (
          <div className="settings-archive-row" key={`session-${session.sessionId}`}>
            <MessageCircle size={16} />
            <span title={session.sessionTitle}>{session.sessionTitle || t('archive.untitled')}<small>{session.projectDisplayName}</small></span>
            <button type="button" disabled={busyId !== null}
              onClick={() => void run(session.sessionId, () => api.restoreSession(session.sessionId), t('archive.restoreFailed'))}>
              <ArchiveRestore size={15} />{t('archive.restore')}
            </button>
            <button type="button" className="danger" disabled={busyId !== null}
              onClick={() => setPendingDelete({ kind: 'session', id: session.sessionId, title: session.sessionTitle || t('archive.untitled') })}>
              <Trash2 size={15} />{t('archive.delete')}
            </button>
          </div>
        ))}
      </SettingsCard>
      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent className="workspace-account-dialog" wrapperClassName="z-[10000]" data-escape-layer>
          <DialogTitle>{t(pendingDelete?.kind === 'project' ? 'archive.deleteProjectTitle' : 'archive.deleteTitle')}</DialogTitle>
          <p>{t(pendingDelete?.kind === 'project' ? 'archive.deleteProjectConfirm' : 'archive.deleteConfirm', { title: pendingDelete?.title ?? '' })}</p>
          <div className="settings-archive-confirm">
            <button type="button" onClick={() => setPendingDelete(null)}>{t('archive.cancel')}</button>
            <button type="button" className="danger" onClick={confirmDelete}>{t('archive.delete')}</button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
