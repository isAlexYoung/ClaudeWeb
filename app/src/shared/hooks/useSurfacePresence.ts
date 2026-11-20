import { useEffect, useState } from 'react';

import { SURFACE_EXIT_MS } from '@/shared/constants';
import { useReducedMotion } from '@/shared/hooks/useReducedMotion';

/** Keeps menus, dialogs and docks mounted through their CSS exit without accepting input. */
export function useSurfacePresence(open: boolean, duration = SURFACE_EXIT_MS) {
  const reducedMotion = useReducedMotion();
  // Retain the existing subtree only until its exit completes; reopening cancels the pending removal.
  const [retained, setRetained] = useState(open);
  if (open && !retained) setRetained(true);
  if (!open && reducedMotion && retained) setRetained(false);
  useEffect(() => {
    if (open || !retained || reducedMotion) return;
    const timer = window.setTimeout(() => setRetained(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, retained, reducedMotion, duration]);

  return {
    isPresent: open || (retained && !reducedMotion),
    presenceProps: {
      'data-motion-state': open ? 'open' : 'closed',
      'aria-hidden': !open || undefined,
      inert: open ? undefined : '',
    },
  };
}
