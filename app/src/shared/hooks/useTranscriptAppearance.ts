import { useEffect, useState } from 'react';

import { readTranscriptAppearance } from '@/shared/utils';
import { subscribeToUserPreferences } from '@/shared/userSettings';

/** Used by settings and ThemeProvider to observe local edits and server-hydrated reading preferences. */
export function useTranscriptAppearance() {
  // Subscribe to the shared preference store, including choices made on another device.
  const [value, setValue] = useState(readTranscriptAppearance);
  useEffect(() => subscribeToUserPreferences(() => setValue(readTranscriptAppearance())), []);
  return value;
}
