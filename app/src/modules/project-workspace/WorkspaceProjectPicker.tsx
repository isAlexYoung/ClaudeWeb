import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronUp, Folder, Plus } from 'lucide-react';

import { ProjectCreationWizard } from '@/modules/project-creation-wizard';
import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import { CHAT_WORKSPACE_PATH, CODE_WORKSPACE_PATH } from '@/shared/constants';
import type { Project } from '@/shared/types';

/** Used by WorkspaceMain in the Code landing composer's leading slot to choose or create a working folder. */
export default function WorkspaceProjectPicker() {
  const { t } = useTranslation('common');
  const { sidebarSharedProps: sidebar } = useProjectSidebarState();
  const { homeProject, selectHomeProject } = useWorkspaceExperience();
  // The folder list opens upward, without navigating away from the unsent task.
  const [open, setOpen] = useState(false);
  // Folder creation reuses the existing directory/clone wizard and returns to this draft.
  const [creating, setCreating] = useState(false);
  const { isPresent, presenceProps } = useSurfacePresence(open);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const projects = sidebar.projects.filter((project) => ![CHAT_WORKSPACE_PATH, CODE_WORKSPACE_PATH].includes((project.fullPath || project.path || '').replace(/\/+$/, '')));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], [role="menuitem"]')?.focus());
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [open]);
  const choose = (project: Project | null) => { selectHomeProject(project); close(); };
  return <div className="workspace-folder-picker" ref={root}>
    <button type="button" ref={trigger} className="workspace-folder-trigger" aria-haspopup="menu" aria-expanded={open}
      title={homeProject?.fullPath || CODE_WORKSPACE_PATH} onClick={() => setOpen((value) => !value)}>
      <Folder size={16} /><span>{homeProject?.displayName || t('workspace.codeHome.chooseFolder')}</span><ChevronUp size={13} className={open ? '' : 'rotate-180'} />
    </button>
    {isPresent && <div {...presenceProps} className="workspace-folder-menu motion-surface" role="menu" aria-label={t('workspace.codeHome.chooseFolder')} ref={menu}
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]') ?? [])];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items[next]?.focus();
      }}>
      <button type="button" role="menuitemradio" aria-checked={!homeProject} onClick={() => choose(null)}><Folder size={16} /><span>{t('workspace.codeHome.defaultFolder')}<small>{CODE_WORKSPACE_PATH}</small></span>{!homeProject && <Check size={14} />}</button>
      <div className="workspace-folder-projects">{projects.map((project) => <button key={project.projectId} type="button" role="menuitemradio" aria-checked={homeProject?.projectId === project.projectId} onClick={() => choose(project)}>
        <Folder size={16} /><span>{project.displayName}<small>{project.fullPath || project.path}</small></span>{homeProject?.projectId === project.projectId && <Check size={14} />}
      </button>)}</div>
      <button type="button" role="menuitem" className="workspace-folder-create" onClick={() => { setOpen(false); setCreating(true); }}><Plus size={16} />{t('workspace.home.createProject')}</button>
    </div>}
    {creating && createPortal(<ProjectCreationWizard onClose={() => { setCreating(false); trigger.current?.focus(); }} onProjectCreated={(project) => {
      void sidebar.onRefresh();
      if (project && typeof project.projectId === 'string') selectHomeProject(project as Project);
      setCreating(false);
      trigger.current?.focus();
    }} />, document.body)}
  </div>;
}
