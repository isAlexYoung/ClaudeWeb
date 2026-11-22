import type { HTMLAttributes } from 'react';

import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import { cn } from '@/shared/utils';

/** Used by sidebar menus/trees and workspace, side-chat and project-memory disclosures to retain their exit. */
export function MotionSurface({ open, kind = 'menu', children, className, ...props }: HTMLAttributes<HTMLDivElement> & {
  open: boolean;
  kind?: 'menu' | 'disclosure';
}) {
  const { isPresent, presenceProps } = useSurfacePresence(open, kind === 'disclosure' ? 240 : undefined);
  if (!isPresent) return null;
  return <div {...props} {...presenceProps} className={cn(kind === 'menu' ? 'motion-surface' : 'motion-disclosure', className)}>
    {kind === 'disclosure' ? <div className="motion-disclosure-clip">{children}</div> : children}
  </div>;
}
