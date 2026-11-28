import type { ReactNode } from 'react';

import ClawdGreeting from '@/modules/clawd/ClawdGreeting';
import type { ClawdMode } from '@/modules/clawd/greetings';
import { useClawdPreferences } from '@/modules/clawd/useClawdPreferences';

/**
 * Used by Chat's new-conversation greeting and the Code home: wraps the page heading so Clawd
 * can stand to its right without moving it off centre. With Clawd turned off the heading is
 * rendered on its own, exactly as before.
 */
export default function ClawdHeading({ mode, children }: { mode: ClawdMode; children: ReactNode }) {
  const { onHome } = useClawdPreferences();
  if (!onHome) return <>{children}</>;
  return (
    <div className={`clawd-heading-host clawd-heading-host-${mode}`}>
      <div className={`clawd-heading clawd-heading-${mode}`}>
        {children}
        <ClawdGreeting mode={mode} />
      </div>
    </div>
  );
}
