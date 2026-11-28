import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/modules/auth';
import { ClawdHeading } from '@/modules/clawd';
import { useWorkspaceProfile } from '@/shared/workspacePreferences';
import { DEFAULT_WORKSPACE_DISPLAY_NAME } from '@/shared/constants';

// Only these greetings address the user; the rest read as a question or a mood and never take a name.
const NAMED_GREETINGS = new Set(['happyDay', 'ideas']);

/** Used by ChatInterface on Chat's new-conversation page, without a logo or other greeting icon. */
export function ChatHomeGreeting() {
  const { t, i18n } = useTranslation('chat');
  const { user } = useAuth();
  const profile = useWorkspaceProfile();
  // Pick a greeting for this visit; typing, model changes and preference updates must not reshuffle it.
  const [greeting] = useState(() => {
    const date = new Date();
    const hour = date.getHours();
    const choices = ['happyDay', hour >= 6 && hour < 19 ? 'coffee' : 'moonlight', 'ideas', 'thinkThrough'];
    if (hour >= 22 || hour < 6) choices.push('lateNight');
    return { date, key: choices[Math.floor(Math.random() * choices.length)] };
  });
  const name = profile.displayName.trim() || (user ? DEFAULT_WORKSPACE_DISPLAY_NAME : '');
  const weekday = new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, { weekday: 'long' }).format(greeting.date);
  const key = NAMED_GREETINGS.has(greeting.key) && !name ? `${greeting.key}Anonymous` : greeting.key;

  return <ClawdHeading mode="chat"><h1 className="workspace-chat-greeting">{t(`workspace.greetings.${key}`, { name, weekday })}</h1></ClawdHeading>;
}
