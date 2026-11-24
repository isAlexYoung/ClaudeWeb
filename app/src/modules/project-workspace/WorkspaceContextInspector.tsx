import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, ChevronRight, X } from 'lucide-react';

import { SideChatInspector } from '@/modules/side-chat';
import { ProjectMemoryInspector } from '@/modules/project-memory';
import { ChangeDiffPanel } from '@/modules/chat';
import { FileTree } from '@/modules/file-tree';
import { WorkspaceToolSlot, useWorkspaceTools } from '@/modules/project-workspace/context/WorkspaceToolsContext';
import { useViewMotion } from '@/shared/hooks/useViewMotion';
import { MotionSurface } from '@/shared/ui';
import { useConnectorStatus } from '@/modules/project-workspace/hooks/useConnectorStatus';
import WorkspaceTaskList from '@/modules/project-workspace/WorkspaceTaskList';
import { useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { Project, ProjectSession, TurnChanges } from '@/shared/types';

type WorkspaceContextInspectorProps = {
  view: 'context' | 'shell' | 'files' | 'browser' | 'changes';
  project: Project | null;
  session: ProjectSession | null;
  onBack: () => void;
  onFileOpen: (filePath: string) => void;
  /** The turn and file a change summary card opened, for the Changes view. */
  changes?: { changes: TurnChanges; path: string } | null;
  onSelectChange?: (path: string) => void;
};

const readNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const compactTokens = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toLocaleString();
const categoryColor = (color?: string) => {
  const colors: Record<string, string> = { blue: '#418ee9', orange: '#df7328', yellow: '#c2a020', cyan: '#13a99b', green: '#13a99b', gray: '#8b8e8b', grey: '#8b8e8b', red: '#d96f6f', purple: '#9c80c8' };
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : colors[color || ''] || '#777b78';
};

/** Used by WorkspaceMain as the live Context/Connectors inspector and as the dock for the existing shell and file modules. */
export default function WorkspaceContextInspector({ view, project, session, onBack, onFileOpen, changes, onSelectChange }: WorkspaceContextInspectorProps) {
  const { t } = useTranslation('common');
  const viewRef = useViewMotion(view);
  const categoryLabel = (name: string) => {
    const keys: Record<string, string> = {
      messages: 'messages', 'system tools': 'systemTools', 'mcp tools': 'mcpTools', 'system prompt': 'systemPrompt',
      skills: 'skills', 'memory files': 'memoryFiles', 'mcp server instructions': 'mcpInstructions',
      'autocompact buffer': 'buffer', 'auto-compact buffer': 'buffer', 'free space': 'free',
      'mcp tools (deferred)': 'mcpDeferred', 'system tools (deferred)': 'systemDeferred',
    };
    const key = keys[name.toLowerCase()];
    return key ? t(`workspace.inspector.categories.${key}`) : name;
  };
  const { contextUsage, contextDetails, mode } = useWorkspaceExperience();
  const tools = useWorkspaceTools();
  const { chatMcpEnabled } = useUiPreferences();
  // Context details stay collapsed until requested, as in the prototype.
  const [contextOpen, setContextOpen] = useState(false);
  // Keep the connector list independently collapsible without discarding its loaded servers.
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const connectorsEnabled = mode === 'project' || chatMcpEnabled;
  const { servers, error: connectorError } = useConnectorStatus(
    project?.fullPath || project?.path, session?.id, view === 'context' && connectorsOpen && connectorsEnabled,
  );

  if (view === 'shell') {
    // The terminal stays where it was opened, even after moving to another conversation.
    const terminalProject = tools.terminal?.project;
    return (
      <aside ref={viewRef} className="workspace-inspector">
        <div className="workspace-inspector-heading">
          <h2 title={terminalProject?.fullPath}>
            {terminalProject
              ? t('workspace.inspector.terminalIn', { name: terminalProject.displayName })
              : t('workspace.inspector.terminal')}
          </h2>
          {/* Back keeps the terminal running; only Close ends it. */}
          <button className="workspace-icon-button" aria-label={t('workspace.inspector.back')} title={t('workspace.inspector.back')} onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
          {tools.terminal && (
            <button className="workspace-icon-button" aria-label={t('workspace.inspector.closeTerminal')} title={t('workspace.inspector.closeTerminal')}
              onClick={() => { tools.closeTerminal(); onBack(); }}>
              <X size={18} />
            </button>
          )}
        </div>
        {tools.terminal
          ? <WorkspaceToolSlot tool="terminal" />
          : <p className="workspace-inspector-note">{t('workspace.inspector.chooseProject')}</p>}
      </aside>
    );
  }

  if (view === 'browser') {
    return (
      <aside ref={viewRef} className="workspace-inspector">
        <div className="workspace-inspector-heading">
          <h2>{t('workspace.inspector.browser')}</h2>
          {/* Back keeps the browser running; only Close ends it. */}
          <button className="workspace-icon-button" aria-label={t('workspace.inspector.back')} title={t('workspace.inspector.back')} onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
          {tools.browser && (
            <button className="workspace-icon-button" aria-label={t('workspace.inspector.closeBrowser')} title={t('workspace.inspector.closeBrowser')}
              onClick={() => { tools.closeBrowser(); onBack(); }}>
              <X size={18} />
            </button>
          )}
        </div>
        {tools.browser && <WorkspaceToolSlot tool="browser" />}
      </aside>
    );
  }

  if (view === 'changes') {
    return (
      <aside ref={viewRef} className="workspace-inspector">
        <div className="workspace-inspector-heading">
          <h2>{t('workspace.inspector.changes')}</h2>
          <button className="workspace-icon-button" aria-label={t('workspace.inspector.back')} title={t('workspace.inspector.back')} onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
        </div>
        {changes
          ? <ChangeDiffPanel changes={changes.changes} path={changes.path} projectRoot={project?.fullPath || project?.path} onSelect={(path) => onSelectChange?.(path)} />
          : <p className="workspace-inspector-note">{t('workspace.inspector.noChanges')}</p>}
      </aside>
    );
  }

  if (view !== 'context') {
    return (
      <aside ref={viewRef} className="workspace-inspector">
        <div className="workspace-inspector-heading">
          <h2>{t('workspace.inspector.files')}</h2>
          <button className="workspace-icon-button" aria-label={t('workspace.inspector.back')} onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
        </div>
        {!project
          ? <p className="workspace-inspector-note">{t('workspace.inspector.chooseProject')}</p>
          : <FileTree selectedProject={project} onFileOpen={onFileOpen} />}
      </aside>
    );
  }

  const used = readNumber(contextDetails?.totalTokens ?? contextUsage?.used);
  const total = readNumber(contextDetails?.maxTokens ?? contextUsage?.total ?? contextUsage?.limit);
  const percentage = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : null;
  const breakdown = contextUsage?.breakdown as Record<string, unknown> | undefined;
  const inputTokens = readNumber(contextUsage?.inputTokens ?? breakdown?.input);
  const outputTokens = readNumber(contextUsage?.outputTokens ?? breakdown?.output);
  return (
    <aside ref={viewRef} className="workspace-inspector workspace-inspector-overview">
      <button className="workspace-inspector-heading" onClick={() => setContextOpen(!contextOpen)} aria-expanded={contextOpen}>
        {contextOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <h2>{t('workspace.inspector.context')}</h2>
        <span className="workspace-context-capsule">{percentage !== null && `${percentage.toFixed(0)}%`}<i><b style={{ width: `${percentage ?? 0}%` }} /></i></span>
      </button>
      <MotionSurface open={contextOpen} kind="disclosure" className="workspace-context-disclosure">
        <div className="workspace-context-details">
          <div>
            {t('workspace.inspector.contextWindow')}
            <strong>{total ? `${used.toLocaleString()} / ${total.toLocaleString()}` : t('workspace.inspector.noUsage')}</strong>
          </div>
          {contextDetails ? <>
            <div className="workspace-context-stack" aria-label={t('workspace.inspector.contextWindow')}>
              {contextDetails.categories.filter(category => !category.isDeferred && !/free space|buffer/i.test(category.name)).map(category => <i key={category.name}
                style={{ width: `${Math.min(100, category.tokens / Math.max(1, total) * 100)}%`, background: categoryColor(category.color) }} />)}
            </div>
            {contextDetails.categories.map((category, index) => <div className="workspace-context-category" key={category.name + index}>
              <i style={{ background: categoryColor(category.color) }} /><span>{categoryLabel(category.name)}</span><strong>{compactTokens(category.tokens)}</strong>
              <small>{category.isDeferred ? '—' : `${(category.tokens / Math.max(1, total) * 100).toFixed(1)}%`}</small>
            </div>)}
            {!!contextDetails.mcpTools?.length && <details><summary>{categoryLabel('MCP tools')} <span>{contextDetails.mcpTools.length}</span></summary>{contextDetails.mcpTools.map(tool => <div key={tool.serverName + tool.name} title={tool.name}>{tool.serverName} · {tool.name}<strong>{compactTokens(tool.tokens)}</strong></div>)}</details>}
            {!!contextDetails.memoryFiles?.length && <details><summary>{categoryLabel('Memory files')} <span>{contextDetails.memoryFiles.length}</span></summary>{contextDetails.memoryFiles.map(file => <div key={file.path} title={file.path}>{file.path}<strong>{compactTokens(file.tokens)}</strong></div>)}</details>}
          </> : <>
            {percentage !== null && <progress value={percentage} max={100} />}
            <p className="workspace-context-unavailable">{t('workspace.inspector.detailsUnavailable')}</p>
          </>}
          <div>{t('workspace.inspector.inputTokens')}<strong>{inputTokens.toLocaleString()}</strong></div>
          <div>{t('workspace.inspector.outputTokens')}<strong>{outputTokens.toLocaleString()}</strong></div>
        </div>
      </MotionSurface>
      <button type="button" className="workspace-inspector-heading" onClick={() => setConnectorsOpen(value => !value)} aria-expanded={connectorsOpen}>
        {connectorsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <h2>{t('workspace.inspector.connectors')}</h2>
      </button>
      <MotionSurface open={connectorsOpen} kind="disclosure" className="workspace-connectors-disclosure">
      {!connectorsEnabled
        ? <p className="workspace-inspector-note">{t('workspace.inspector.chatMcpOff')}</p>
        : connectorError
          ? <p className="workspace-inspector-note" role="status">{t('workspace.inspector.connectorsUnavailable')}</p>
          : !servers.length
            ? <p className="workspace-inspector-note">{t('workspace.inspector.noConnectors')}</p>
            : servers.map(({ name, status }) => (
              <div className="workspace-connector" key={name}>
                <span>{name.slice(0, 1).toUpperCase()}</span>
                <div>{name}<small data-connection-status={status}>{t(`workspace.inspector.${status}`)}</small></div>
              </div>
            ))}
      </MotionSurface>
      <SideChatInspector sessionId={session?.id || null} />
      <ProjectMemoryInspector projectId={mode === 'project' ? project?.projectId || null : null} projectName={project?.displayName || ''} sessionId={session?.id || null} onFileOpen={onFileOpen} />
      <WorkspaceTaskList sessionId={session?.id || null} />
    </aside>
  );
}
