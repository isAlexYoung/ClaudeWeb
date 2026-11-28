import { useEffect, useState } from 'react';

import { CLAWD_STATE_ANIMATIONS, ClawdSprite, nextAnimation, randomAnimation } from '@/modules/clawd';
import type { ClawdState } from '@/modules/clawd';
import { finishedClawdState, liveClawdState } from '@/modules/chat/clawd/composerClawdState';
import type { ComposerClawdInput } from '@/modules/chat/clawd/composerClawdState';

// A state shows at least this long, so a run of quick tool calls does not flicker.
const MIN_DWELL_MS = 1500;
// How long the end of a turn is shown before Clawd goes back to idle.
const MOMENT_MS: Partial<Record<ClawdState, number>> = { done: 4000, stopped: 4000, error: 8000 };
// These show at once: they ask for attention or report how a turn ended.
const URGENT = new Set<ClawdState>(['waiting', 'done', 'stopped', 'error', 'sleeping']);

type ComposerClawdProps = ComposerClawdInput & {
  /** The conversation shown; switching conversations starts over without an end-of-turn moment. */
  conversationKey: string;
  isStopping: boolean;
  still: boolean;
  doubleClick: boolean;
};

type Turn = { key: string; processing: boolean; stopping: boolean };
type Moment = { key: string; state: ClawdState; id: number };
type Shown = { state: ClawdState; since: number; animation: number };

/**
 * Used by ChatInterface above a conversation's composer: Clawd acts out what Claude is doing
 * (thinking, writing, editing files, running commands, waiting for a permission) and how the
 * turn ended (celebrating, stopped, upset, asleep at a usage limit).
 */
export default function ComposerClawd({ conversationKey, isStopping, still, doubleClick, ...input }: ComposerClawdProps) {
  const { isProcessing, messages } = input;
  const live = liveClawdState(input);
  const [turn, setTurn] = useState<Turn>({ key: conversationKey, processing: isProcessing, stopping: isProcessing && isStopping });
  // A turn's ending, shown for a moment after it ends in this conversation.
  const [moment, setMoment] = useState<Moment | null>(null);

  // Follows the turn while rendering: the stop flag clears in the same update that ends the
  // turn, so it is remembered for the whole turn, and the ending is judged as it happens.
  const sameConversation = turn.key === conversationKey;
  const stopping = isProcessing && ((sameConversation && turn.stopping) || isStopping);
  if (!sameConversation || turn.processing !== isProcessing || turn.stopping !== stopping) {
    if (sameConversation && turn.processing && !isProcessing) {
      const ended = finishedClawdState(messages, turn.stopping || isStopping);
      setMoment(MOMENT_MS[ended] ? { key: conversationKey, state: ended, id: (moment?.id ?? 0) + 1 } : null);
    } else if (isProcessing || !sameConversation) {
      setMoment(null);
    }
    setTurn({ key: conversationKey, processing: isProcessing, stopping });
  }

  useEffect(() => {
    if (!moment) return undefined;
    const timer = setTimeout(() => setMoment((current) => (current?.id === moment.id ? null : current)), MOMENT_MS[moment.state] ?? 4000);
    return () => clearTimeout(timer);
  }, [moment]);

  const target: ClawdState = moment?.key === conversationKey ? moment.state : live;
  const [shown, setShown] = useState<Shown>(() => ({ state: target, since: 0, animation: randomAnimation(CLAWD_STATE_ANIMATIONS[target]) }));

  useEffect(() => {
    if (shown.state === target) return undefined;
    const wait = URGENT.has(target) ? 0 : Math.max(0, MIN_DWELL_MS - (Date.now() - shown.since));
    const timer = setTimeout(() => setShown((current) => (current.state === target ? current : {
      state: target, since: Date.now(), animation: randomAnimation(CLAWD_STATE_ANIMATIONS[target], current.animation),
    })), wait);
    return () => clearTimeout(timer);
  }, [target, shown.state, shown.since]);

  return (
    <div className="clawd-composer" data-clawd-state={shown.state}>
      <ClawdSprite
        animation={shown.animation}
        size={72}
        still={still}
        onDoubleActivate={doubleClick
          ? () => setShown((current) => ({ ...current, animation: nextAnimation(CLAWD_STATE_ANIMATIONS[current.state], current.animation) }))
          : undefined}
      />
    </div>
  );
}
