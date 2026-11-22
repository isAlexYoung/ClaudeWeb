import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { DesktopModal } from '@/modules/claude-desktop';
import { BrowserPanel } from '@/modules/browser-panel';
import { StandaloneShell } from '@/modules/standalone-shell';
import type { Project, ProjectSession } from '@/shared/types';

export type WorkspaceToolName = 'terminal' | 'browser';

type TerminalTool = { project: Project; session: ProjectSession | null };

type WorkspaceTools = {
  terminal: TerminalTool | null;
  desktop: { minimized: boolean } | null;
  openDesktop: () => void;
  minimized: { terminal: boolean; browser: boolean; desktop: boolean };
  /** True while the browser panel is open (shown or parked). */
  browser: boolean;
  /** Opens the terminal for this project and conversation, or keeps the one already open. */
  openTerminal: (project: Project, session: ProjectSession | null) => void;
  /** Ends the terminal; only the user's Close does this. */
  closeTerminal: () => void;
  /** Opens the browser panel, or keeps the one already open. */
  openBrowser: () => void;
  /** Ends the browser; only the user's Close does this. */
  closeBrowser: () => void;
  /** Used by WorkspaceToolSlot to show a live tool where it is rendered. */
  attach: (tool: WorkspaceToolName, slot: HTMLElement | null) => void;
};

const Context = createContext<WorkspaceTools | null>(null);

/**
 * Keeps the right-hand terminal and browser alive while the user is elsewhere.
 *
 * Each live tool is rendered once, here, into a detached element. A
 * WorkspaceToolSlot moves that element into the inspector while it is shown;
 * leaving (Back, collapsing the inspector, another conversation or the
 * Scheduled tasks page) parks it again without unmounting, so the shell or
 * browser and its screen survive. It ends only through closeTerminal() or
 * closeBrowser().
 *
 * The terminal keeps the project and conversation it was opened with, so
 * moving to another chat does not restart it.
 */
export function WorkspaceToolsProvider({ children }: { children: ReactNode }) {
  // Live tools survive navigation and minimizing until explicitly closed.
  const [terminal, setTerminal] = useState<TerminalTool | null>(null);
  // Browser lifetime is independent of its visible inspector.
  const [browser, setBrowser] = useState(false);
  // Dock attachment determines whether each live tool is minimized.
  const [visible, setVisible] = useState<Record<WorkspaceToolName, boolean>>({ terminal: false, browser: false });
  const parking = useRef<HTMLDivElement>(null);
  // One desktop modal retains its noVNC connection while hidden.
  const [desktop, setDesktop] = useState<{ minimized: boolean } | null>(null);
  // Stable portal surfaces preserve component and connection identities.
  const [surfaces] = useState(() => {
    const surface = () => {
      const element = document.createElement('div');
      element.className = 'workspace-tool-surface';
      return element;
    };
    return { terminal: surface(), browser: surface() } as Record<WorkspaceToolName, HTMLDivElement>;
  });

  useLayoutEffect(() => {
    for (const element of Object.values(surfaces)) {
      if (!element.parentElement) parking.current?.appendChild(element);
    }
  }, [surfaces]);

  const attach = useCallback((tool: WorkspaceToolName, slot: HTMLElement | null) => {
    const element = surfaces[tool];
    if (slot) slot.appendChild(element);
    else if (parking.current) parking.current.appendChild(element);
    setVisible((current) => (current[tool] === Boolean(slot) ? current : { ...current, [tool]: Boolean(slot) }));
  }, [surfaces]);

  const openTerminal = useCallback((project: Project, session: ProjectSession | null) => {
    setTerminal((current) => current ?? { project, session });
  }, []);
  const closeTerminal = useCallback(() => setTerminal(null), []);
  const openBrowser = useCallback(() => setBrowser(true), []);
  const closeBrowser = useCallback(() => setBrowser(false), []);

  const openDesktop = useCallback(() => setDesktop({ minimized: false }), []);

  const value = useMemo<WorkspaceTools>(() => ({ terminal, browser, desktop, openDesktop, minimized: { terminal: Boolean(terminal) && !visible.terminal, browser: browser && !visible.browser, desktop: Boolean(desktop?.minimized) }, openTerminal, closeTerminal, openBrowser, closeBrowser, attach }),
    [terminal, browser, desktop, openDesktop, visible, openTerminal, closeTerminal, openBrowser, closeBrowser, attach]);

  return (
    <Context.Provider value={value}>
      {children}
      <div ref={parking} className="workspace-tool-parking" aria-hidden />
      {terminal && createPortal(
        <StandaloneShell project={terminal.project} session={terminal.session} showHeader={false}
          isActive={visible.terminal} endSessionOnUnmount />,
        surfaces.terminal,
      )}
      {desktop && <DesktopModal minimized={desktop.minimized} onMinimize={() => setDesktop({ minimized: true })} onClose={() => setDesktop(null)} />}
      {browser && createPortal(<BrowserPanel visible={visible.browser} />, surfaces.browser)}
    </Context.Provider>
  );
}

/** Used by the project-workspace module to open, show and close the persistent tools. */
export function useWorkspaceTools(): WorkspaceTools {
  const value = useContext(Context);
  if (!value) throw new Error('WorkspaceToolsProvider is required');
  return value;
}

/** Shows a live tool here while mounted; unmounting parks it instead of ending it. */
export function WorkspaceToolSlot({ tool }: { tool: WorkspaceToolName }) {
  const { attach } = useWorkspaceTools();
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    attach(tool, slot.current);
    return () => attach(tool, null);
  }, [attach, tool]);
  return <div ref={slot} className="workspace-tool-slot" />;
}
