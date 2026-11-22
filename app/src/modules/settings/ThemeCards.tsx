import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import type { ThemeMode } from '@/shared/types';

// The three palettes of the approved design, plus following the OS (the default for new users).
const THEMES: ThemeMode[] = ['system', 'warm', 'light', 'dark'];

/** Used by AppearanceSettingsTab to choose between the workspace themes. */
export default function ThemeCards() {
  const { t } = useTranslation('settings');
  const { themeMode, setThemeMode } = useTheme();

  return (
    <div className="flex flex-wrap gap-2 py-3">
      {THEMES.map((id) => {
        return (
          <button
            key={id}
            type="button"
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${themeMode === id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}
            aria-pressed={themeMode === id}
            onClick={() => setThemeMode(id)}
          >
            <span className="inline-flex items-center gap-2">
              {t(`workspaceThemes.${id}`)}
              {themeMode === id && <Check size={15} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
