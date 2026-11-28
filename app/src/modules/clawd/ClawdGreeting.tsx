import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePaletteOps } from '@/modules/command-palette';
import ClawdSprite from '@/modules/clawd/ClawdSprite';
import { pickGreeting } from '@/modules/clawd/greetings';
import type { ClawdMode } from '@/modules/clawd/greetings';
import { nextAnimation } from '@/modules/clawd/states';
import { useClawdPreferences } from '@/modules/clawd/useClawdPreferences';

/**
 * Used next to the greeting of a new Chat conversation and on the Code home: Clawd says hello,
 * marks a holiday, or offers something to do together. Clicking the bubble puts that invitation
 * in the composer (it is not sent). Rendered inside the heading row, after the heading.
 */
export default function ClawdGreeting({ mode }: { mode: ClawdMode }) {
  const { t } = useTranslation('common');
  const { onHome: clawdOnHome, doubleClick: clawdDoubleClick, festivals: clawdFestivals, still: clawdStill } = useClawdPreferences();
  const { insertComposerText } = usePaletteOps();
  // Chosen once per visit, so typing or a preference change does not reshuffle the greeting.
  const [visit] = useState(() => ({ date: new Date(), roll: Math.random() }));
  const greeting = useMemo(() => pickGreeting(mode, visit.date, { festivals: clawdFestivals, roll: visit.roll }), [mode, visit, clawdFestivals]);
  // The animation the user switched to with a double click, for this greeting.
  const [switched, setSwitched] = useState<{ id: string; animation: number } | null>(null);
  const animation = switched?.id === greeting.id ? switched.animation : greeting.animations[0];

  if (!clawdOnHome) return null;
  const prompt = t(`clawd.greetings.${greeting.id}.prompt`);
  return (
    <div className="clawd-greeting" data-clawd-greeting={greeting.id}>
      <ClawdSprite
        animation={animation}
        size={mode === 'code' ? 80 : 96}
        still={clawdStill}
        onDoubleActivate={clawdDoubleClick && greeting.animations.length > 1
          ? () => setSwitched({ id: greeting.id, animation: nextAnimation(greeting.animations, animation) })
          : undefined}
      />
      <button type="button" className="clawd-bubble" title={t('clawd.bubbleHint')} onClick={() => insertComposerText(prompt)}>
        {t(`clawd.greetings.${greeting.id}.text`)}
      </button>
    </div>
  );
}
