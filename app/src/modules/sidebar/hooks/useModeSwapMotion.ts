import { useLayoutEffect, useRef } from 'react';

import { useReducedMotion } from '@/shared/hooks/useReducedMotion';
import type { WorkspaceMode } from '@/shared/types';

/**
 * Used by IntegratedSidebar: when the Chat/Code mode changes, the sidebar's
 * entries and conversation list slide in from the side of the mode chosen
 * (Code is to the right of Chat) and fade in. Nothing remounts: the
 * animation runs on the existing element, so open menus and scroll stay.
 */
export function useModeSwapMotion(mode: WorkspaceMode) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  // The mode the last animation ran for; the first render does not animate.
  const previousMode = useRef(mode);

  useLayoutEffect(() => {
    if (previousMode.current === mode) return undefined;
    previousMode.current = mode;
    const element = ref.current;
    if (!element?.animate || reducedMotion) return undefined;
    const offset = mode === 'project' ? 10 : -10;
    const animation = element.animate([
      { opacity: 0, transform: `translateX(${offset}px)` },
      { opacity: 1, transform: 'none' },
    ], { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    return () => animation.cancel();
  }, [mode, reducedMotion]);

  return ref;
}
