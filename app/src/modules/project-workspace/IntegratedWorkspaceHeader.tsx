import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Braces,
  CheckSquare,
  Copy,
  FileCode2,
  FileText,
  Folder,
  Gauge,
  Globe,
  MoreHorizontal,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  TerminalSquare,
} from 'lucide-react';

import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import { useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import type { Project, ProjectSession, TranscriptExportFormat } from '@/shared/types';

type IntegratedWorkspaceHeaderProps = {
  project: Project | null;
  session: ProjectSession | null;
  mobile: boolean;
  inspectorOpen: boolean;
  onMenu: () => void;
  onInspectorToggle: () => void;
  onTool: (tool: 'context' | 'shell' | 'files' | 'browser') => void;
  onTasks: () => void;
  /** Renames the open conversation; absent when there is none. */
  onRenameSession?: (summary: string) => Promise<boolean>;
};

const EXPORT_FORMATS: Array<{ format: TranscriptExportFormat; icon: typeof FileText }> = [
  { format: 'html', icon: FileCode2 },
  { format: 'markdown', icon: FileText },
  { format: 'json', icon: Braces },
];

// How long the copy/export result stays next to the menu button.
const NOTICE_MS = 2500;

/** Used by WorkspaceMain for the title and the right-aligned tools approved in the HTML prototype. */
export default function IntegratedWorkspaceHeader(props: IntegratedWorkspaceHeaderProps) {
  const { t } = useTranslation('common');
  const { transcriptActions, home, mode } = useWorkspaceExperience();
  // The More menu holds Tasks, Context and the conversation's copy/export actions.
  const [moreOpen, setMoreOpen] = useState(false);
  // A short confirmation or failure after copy/export, since both finish out of sight.
  const [notice, setNotice] = useState<string | null>(null);
  const { isPresent, presenceProps } = useSurfacePresence(moreOpen);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const runTranscriptAction = async (action: () => Promise<void>, done: string) => {
    setMoreOpen(false);
    try {
      await action();
      setNotice(done);
    } catch (error) {
      console.error('Conversation copy/export failed:', error);
      setNotice(t('workspace.header.actionFailed'));
    }
  };

  // The two homes are named like the sidebar's Chat / Code switch, in every language.
  const modeName = mode === 'project' ? 'Code' : 'Chat';
  const sessionTitle = String(props.session?.summary || props.session?.title || '').trim();
  // In Code the project says where the conversation runs; Chat's reserved workspace has no name worth showing.
  const projectName = !home && mode === 'project' && sessionTitle ? props.project?.displayName : '';
  const title = home ? modeName : sessionTitle || props.project?.displayName || modeName;
  const canRename = !home && Boolean(props.session && sessionTitle && props.onRenameSession);
  // Clicking the title edits it in place; Enter or leaving the field saves, Escape cancels.
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => { setRenaming(null); }, [props.session?.id]);
  const saveRename = async () => {
    const next = renaming?.trim();
    setRenaming(null);
    if (next && next !== sessionTitle) await props.onRenameSession?.(next);
  };

  return (
    <header className="workspace-header">
      {props.mobile && (
        <button className="workspace-icon-button" aria-label={t('workspace.header.openNavigation')} onClick={props.onMenu}>
          <PanelLeftOpen size={19} />
        </button>
      )}
      <div className="workspace-header-title">
        {renaming !== null ? (
          <input
            className="workspace-header-rename"
            aria-label={t('workspace.header.renameLabel')}
            value={renaming}
            autoFocus
            maxLength={200}
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={() => void saveRename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); void saveRename(); }
              if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); }
            }}
          />
        ) : canRename ? (
          <button type="button" className="workspace-header-title-button" title={t('workspace.header.renameHint')} onClick={() => setRenaming(sessionTitle)}>
            {title}
          </button>
        ) : <span>{title}</span>}
        {projectName && <span className="workspace-header-project">· {projectName}</span>}
      </div>
      <div className="workspace-header-tools">
        {notice && <span className="workspace-header-notice" role="status">{notice}</span>}
        <button className="workspace-icon-button" aria-label={t('workspace.header.terminal')} title={t('workspace.header.terminal')} onClick={() => props.onTool('shell')}>
          <TerminalSquare size={19} />
        </button>
        <button className="workspace-icon-button" aria-label={t('workspace.header.files')} title={t('workspace.header.files')} onClick={() => props.onTool('files')}>
          <Folder size={19} />
        </button>
        <button className="workspace-icon-button" aria-label={t('workspace.header.browser')} title={t('workspace.header.browser')} onClick={() => props.onTool('browser')}>
          <Globe size={19} />
        </button>
        <div className="workspace-more-anchor" ref={menuRef}>
          <button
            className="workspace-icon-button"
            aria-label={t('workspace.header.more')}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <MoreHorizontal size={19} />
          </button>
          {isPresent && (
            <div {...presenceProps} className="workspace-project-menu motion-surface" role="menu">
              <button role="menuitem" onClick={() => { setMoreOpen(false); props.onTasks(); }}>
                <CheckSquare size={16} />
                {t('workspace.header.tasks')}
              </button>
              <button role="menuitem" onClick={() => { setMoreOpen(false); props.onTool('context'); }}>
                <Gauge size={16} />
                {t('workspace.header.context')}
              </button>
              {transcriptActions && (
                <>
                  <hr />
                  <button
                    role="menuitem"
                    onClick={() => void runTranscriptAction(transcriptActions.copy, t('workspace.header.copied'))}
                  >
                    <Copy size={16} />
                    {t('workspace.header.copyConversation')}
                  </button>
                  {EXPORT_FORMATS.map(({ format, icon: Icon }) => (
                    <button
                      key={format}
                      role="menuitem"
                      onClick={() => void runTranscriptAction(() => transcriptActions.download(format), t('workspace.header.exported'))}
                    >
                      <Icon size={16} />
                      {t(`workspace.header.export.${format}`)}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        <button
          className="workspace-icon-button"
          aria-label={props.inspectorOpen ? t('workspace.header.hideInspector') : t('workspace.header.showInspector')}
          aria-expanded={props.inspectorOpen}
          onClick={props.onInspectorToggle}
        >
          {props.inspectorOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
        </button>
      </div>
    </header>
  );
}
