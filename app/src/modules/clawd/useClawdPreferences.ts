import { useOptionalUiPreferences } from '@/shared/context/UiPreferencesContext';

export type ClawdPreferences = {
  onHome: boolean;
  aboveComposer: boolean;
  doubleClick: boolean;
  festivals: boolean;
  still: boolean;
};

/**
 * Clawd's switches from Settings → Appearance. Clawd is decoration, so a page rendered without
 * the preferences provider (a test, an isolated preview) shows it with the defaults instead of failing.
 */
export function useClawdPreferences(): ClawdPreferences {
  const preferences = useOptionalUiPreferences();
  return {
    onHome: preferences?.clawdOnHome ?? true,
    aboveComposer: preferences?.clawdAboveComposer ?? true,
    doubleClick: preferences?.clawdDoubleClick ?? true,
    festivals: preferences?.clawdFestivals ?? true,
    still: preferences?.clawdStill ?? false,
  };
}
