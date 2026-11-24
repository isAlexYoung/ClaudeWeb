import { memo, useCallback, useEffect, useRef } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { Sidebar } from '@/modules/sidebar';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import {
  SIDEBAR_WIDTH_KEYBOARD_STEP,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useSidebarWidth,
} from '@/shared/hooks/useSidebarWidth';
import type { ProjectWorkspaceShellProps } from '@/shared/types';

/** Rendered by ProjectWorkspaceShell to host the sidebar module, docked on desktop and as a drawer on mobile. */
function ProjectSidebarRegion({
  isMobile,
}: Pick<ProjectWorkspaceShellProps, 'isMobile'>) {
  const { t } = useTranslation('common');
  const { sidebarOpen, setSidebarOpen, sidebarSharedProps } = useProjectSidebarState();
  const { width: sidebarWidth, setWidth: setSidebarWidth, resetWidth: resetSidebarWidth } = useSidebarWidth();
  // Hide sidebar leaves a 48px icon rail behind, which sizes itself — the stored
  // width and the drag handle only apply while the full sidebar is on screen.
  const { sidebarVisible } = useUiPreferences();
  const isSidebarResizable = !isMobile && sidebarVisible;
  // Drag origin; null while no resize is in progress.
  const resizeOriginRef = useRef<{ pointerX: number; width: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number>(sidebarWidth);
  const desktopRef = useRef<HTMLDivElement>(null);

  const handleBackdropClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleBackdropTouch = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  // Sidebar resizing (desktop only). Pointer capture keeps the drag alive when
  // the cursor leaves the 4px handle, and the width is only written to storage
  // once the pointer is released.
  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeOriginRef.current = { pointerX: event.clientX, width: sidebarWidth };
    pendingWidthRef.current = sidebarWidth;
    document.body.style.userSelect = 'none';
    desktopRef.current?.setAttribute('data-resizing', 'true');
  }, [sidebarWidth]);

  const handleResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = resizeOriginRef.current;
    if (!origin) return;

    pendingWidthRef.current = origin.width + (event.clientX - origin.pointerX);
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      setSidebarWidth(pendingWidthRef.current, false);
    });
  }, [setSidebarWidth]);

  const handleResizeEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeOriginRef.current) return;
    resizeOriginRef.current = null;

    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.userSelect = '';
    desktopRef.current?.removeAttribute('data-resizing');
    setSidebarWidth(pendingWidthRef.current);
  }, [setSidebarWidth]);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSidebarWidth(sidebarWidth - SIDEBAR_WIDTH_KEYBOARD_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSidebarWidth(sidebarWidth + SIDEBAR_WIDTH_KEYBOARD_STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      resetSidebarWidth();
    }
  }, [resetSidebarWidth, setSidebarWidth, sidebarWidth]);

  // Going mobile or collapsing mid-drag unmounts the separator, so the pointerup
  // that would have ended the drag never arrives: the body stays unselectable, and
  // the live origin would make a plain hover resize the sidebar once it is back.
  useEffect(() => {
    if (isSidebarResizable) return;
    resizeOriginRef.current = null;
    desktopRef.current?.removeAttribute('data-resizing');
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    document.body.style.userSelect = '';
  }, [isSidebarResizable]);

  // A drag interrupted by an unmount must not leave the page unselectable.
  useEffect(() => () => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
    document.body.style.userSelect = '';
  }, []);

  if (!isMobile) {
    return (
      <div
        ref={desktopRef}
        className="workspace-sidebar-region relative h-full flex-shrink-0 border-r border-border/50"
        data-collapsed={!sidebarVisible}
        style={{ width: isSidebarResizable ? sidebarWidth : 52 }}
      >
        <Sidebar {...sidebarSharedProps} />
        {isSidebarResizable && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('versionUpdate.ariaLabels.resizeSidebar')}
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_WIDTH_MIN}
            aria-valuemax={SIDEBAR_WIDTH_MAX}
            tabIndex={0}
            className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onDoubleClick={resetSidebarWidth}
            onKeyDown={handleResizeKeyDown}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="workspace-mobile-navigation fixed inset-0 z-50 flex"
      data-motion-state={sidebarOpen ? 'open' : 'closed'}
      aria-hidden={!sidebarOpen || undefined}
      {...(sidebarOpen ? {} : { inert: '' })}
    >
      <button
        className="workspace-navigation-backdrop fixed inset-0 bg-background/60 backdrop-blur-sm"
        onClick={handleBackdropClick}
        onTouchStart={handleBackdropTouch}
        aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
      />
      <div
        className="workspace-navigation-drawer relative h-full w-[85vw] max-w-sm border-r border-border/40 bg-card sm:w-80"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <Sidebar {...sidebarSharedProps} onNavigatePage={() => setSidebarOpen(false)} />
      </div>
    </div>
  );
}

export default memo(ProjectSidebarRegion);
