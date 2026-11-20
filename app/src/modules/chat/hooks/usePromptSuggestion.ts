import { useCallback, useEffect, useRef, useState } from 'react';

import type { ServerEvent } from '@/shared/types';

/** Used by ChatInterface for transient SDK suggestions; text becomes a draft only when accepted. */
export function usePromptSuggestion({ sessionId, subscribe, enabled, input, blocked, loading }: {
  sessionId: string | null;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  enabled: boolean;
  input: string;
  blocked: boolean;
  loading: boolean;
}) {
  // A run token prevents a delayed/replayed suggestion from replacing a newer turn's suggestion.
  const turn = useRef<{ id: string; dismissed: boolean } | null>(null);
  // Display-only state, separate from the persisted composer draft and transcript.
  const [candidate, setCandidate] = useState<{ sessionId: string; text: string } | null>(null);
  const dismiss = useCallback(() => {
    if (turn.current) turn.current.dismissed = true;
    setCandidate(null);
  }, []);

  useEffect(() => {
    turn.current = null;
    setCandidate(null);
    if (!sessionId || !enabled) return;
    return subscribe((event) => {
      if (event.kind === 'websocket_reconnected') { turn.current = null; setCandidate(null); return; }
      if (event.sessionId !== sessionId) return;
      if (event.kind === 'status' && event.text === 'prompt_suggestion_turn' && typeof event.requestId === 'string') {
        turn.current = { id: event.requestId, dismissed: false };
        setCandidate(null);
      } else if (event.kind === 'status' && event.text === 'prompt_suggestion') {
        if (!turn.current || turn.current.dismissed || event.requestId !== turn.current.id) return;
        if (typeof event.content === 'string' && event.content.trim()) setCandidate({ sessionId, text: event.content.trim() });
      } else if (event.kind === 'error' || (event.kind === 'complete' && (event.aborted || event.exitCode))) {
        dismiss();
      }
    });
  }, [sessionId, enabled, subscribe, dismiss]);

  useEffect(() => { if (input.length || blocked) dismiss(); }, [input, blocked, dismiss]);

  return {
    suggestion: enabled && !loading && !blocked && !input.length && candidate?.sessionId === sessionId ? candidate.text : '',
    dismiss,
  };
}
