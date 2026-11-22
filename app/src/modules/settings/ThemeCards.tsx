import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import type { ThemeMode } from '@/shared/types';

// The three palettes of the approved design, plus following the OS (the default for new users).
const THEMES: ThemeMode[] = ['system', 'warm', 'light', 'dark'];

/** Used by AppearanceSettingsTab to choose between the workspace themes. */
export default function ThemeCards() {
  const { t } = useTranslation('settings');
  const { themeMode, isDarkMode, setThemeMode } = useTheme();

  return (
    <div className="workspace-theme-cards">
      {THEMES.map((id) => {
        // "Follow system" previews whichever palette the OS currently picks.
        const palette = id === 'system' ? (isDarkMode ? 'dark' : 'light') : id;
        return (
          <button
            key={id}
            type="button"
            className="workspace-theme-card"
            data-palette={palette}
            aria-pressed={themeMode === id}
            onClick={() => setThemeMode(id)}
          >
            <span className="workspace-theme-preview"><i /><b><em /><em /><em /></b><i /></span>
            <span>
              {t(`workspaceThemes.${id}`)}
              {themeMode === id && <Check size={15} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
