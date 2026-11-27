import { createContext } from 'react';

/**
 * Opens a link in the server's built-in browser. Provided by ExtensionsSettingsPage when its
 * host can show that browser (the workspace Plugins page); Settings has none, so PluginLink
 * opens links there in a new tab of the user's own browser.
 */
export const PluginLinkContext = createContext<((url: string) => void) | null>(null);
