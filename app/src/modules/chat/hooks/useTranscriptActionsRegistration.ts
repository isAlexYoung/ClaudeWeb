import { useEffect, useRef } from 'react';

import { useOptionalWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import { buildTranscriptExport, downloadTranscriptExport } from '@/modules/chat/utils/chatExport';
import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';

type TranscriptSource = {
  messages: ChatMessage[];
  sessionTitle: string;
  provider: LLMProvider | string;
  selectedProject?: Project | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  /** Loads the rest of a paged transcript, so a copy or export holds the whole conversation. */
  onLoadFullTranscript?: () => Promise<ChatMessage[]>;
};

/**
 * Registers copy and export of the open transcript with the integrated workspace,
 * whose header offers them in its More menu. Returns whether a workspace took
 * them, so the transcript can leave out its own floating export menu.
 */
export function useTranscriptActionsRegistration(source: TranscriptSource): boolean {
  const experience = useOptionalWorkspaceExperience();
  const setTranscriptActions = experience?.setTranscriptActions;
  // The registered callbacks read the newest transcript without re-registering on every message.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const hasMessages = source.messages.length > 0;

  useEffect(() => {
    if (!setTranscriptActions || !hasMessages) return undefined;

    const resolveInput = async () => {
      const current = sourceRef.current;
      const fullMessages = (await current.onLoadFullTranscript?.()) ?? current.messages;
      return {
        messages: fullMessages.length > 0 ? fullMessages : current.messages,
        sessionTitle: current.sessionTitle,
        provider: current.provider,
        selectedProject: current.selectedProject,
        createDiff: current.createDiff,
      };
    };

    setTranscriptActions({
      copy: async () => {
        const markdown = await buildTranscriptExport('markdown', await resolveInput(), new Date());
        await navigator.clipboard.writeText(markdown);
      },
      download: async (format) => {
        await downloadTranscriptExport(format, resolveInput, sourceRef.current.sessionTitle);
      },
    });
    return () => setTranscriptActions(null);
  }, [hasMessages, setTranscriptActions]);

  return Boolean(setTranscriptActions);
}
