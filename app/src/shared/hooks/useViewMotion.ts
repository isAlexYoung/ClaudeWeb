import { useLayoutEffect, useRef } from 'react';

import { useReducedMotion } from '@/shared/hooks/useReducedMotion';

/** Softens workspace/settings view changes without keying or remounting their live contents. */
export function useViewMotion(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element?.animate || reducedMotion) return;
    const animation = element.animate([
      { opacity: 0.65 },
      { opacity: 1 },
    ], { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    return () => animation.cancel();
  }, [identity, reducedMotion]);

  return ref;
}
