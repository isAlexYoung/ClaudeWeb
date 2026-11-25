import { createContext, useContext } from 'react';

import type { ScheduledMessage } from '@/shared/types';

/**
 * What a usage-limit card needs to offer "continue when the limit resets":
 * the session's scheduled messages (to show whether it is set, sent or
 * failed) and a way to schedule or cancel the continue message. ChatInterface
 * provides it for the open session; outside one (an exported document, a bare
 * render) it is null and the card shows the limit only.
 */
export type UsageLimitResumeValue = {
  scheduledMessages: ScheduledMessage[];
  /** Schedules the continue message for a reset; resolves false when the server refused. */
  scheduleResume: (resetsAt: Date) => Promise<boolean>;
  cancel: (id: string) => Promise<void>;
};

export const UsageLimitResumeContext = createContext<UsageLimitResumeValue | null>(null);

export function useUsageLimitResume(): UsageLimitResumeValue | null {
  return useContext(UsageLimitResumeContext);
}
