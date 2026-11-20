import { useEffect, useState } from 'react';

import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/**
 * WebDesktop's own appearance and profile settings, stored in `auth.db`
 * alongside the other user preferences.
 *
 * The profile is a local label for the bottom-left account button only: it is
 * never sent to Claude and has nothing to do with the Claude Desktop profile.
 */

export type UiFont = 'inter' | 'system';
export type ChatFont = 'serif' | 'sans' | 'system';

export type WorkspaceFonts = {
  uiFont: UiFont;
  chatFont: ChatFont;
};

export type WorkspaceProfile = {
  displayName: string;
  /** A small data: URL the settings page produced by downscaling the upload, or null. */
  avatar: string | null;
};

export const UI_FONTS: UiFont[] = ['inter', 'system'];
export const CHAT_FONTS: ChatFont[] = ['serif', 'sans', 'system'];
export const MAX_DISPLAY_NAME_LENGTH = 40;

/**
 * A stored avatar is the 160px image the settings page produced; anything far
 * larger did not come from there and is ignored rather than rendered.
 */
const MAX_AVATAR_DATA_URL_LENGTH = 400_000;

const DEFAULT_FONTS: WorkspaceFonts = { uiFont: 'inter', chatFont: 'serif' };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export function readWorkspaceFonts(): WorkspaceFonts {
  const stored = readUserPreference<unknown>('workspaceFonts', null);
  const record = isRecord(stored) ? stored : {};
  return {
    uiFont: UI_FONTS.includes(record.uiFont as UiFont) ? record.uiFont as UiFont : DEFAULT_FONTS.uiFont,
    chatFont: CHAT_FONTS.includes(record.chatFont as ChatFont) ? record.chatFont as ChatFont : DEFAULT_FONTS.chatFont,
  };
}

export function writeWorkspaceFonts(update: Partial<WorkspaceFonts>): void {
  writeUserPreference('workspaceFonts', { ...readWorkspaceFonts(), ...update });
}

export function readWorkspaceProfile(): WorkspaceProfile {
  const stored = readUserPreference<unknown>('workspaceProfile', null);
  const record = isRecord(stored) ? stored : {};
  const displayName = typeof record.displayName === 'string'
    ? record.displayName.slice(0, MAX_DISPLAY_NAME_LENGTH)
    : '';
  const avatar = typeof record.avatar === 'string'
    && /^data:image\/(png|jpeg|webp);base64,/.test(record.avatar)
    && record.avatar.length <= MAX_AVATAR_DATA_URL_LENGTH
    ? record.avatar
    : null;
  return { displayName, avatar };
}

export function writeWorkspaceProfile(update: Partial<WorkspaceProfile>): void {
  writeUserPreference('workspaceProfile', { ...readWorkspaceProfile(), ...update });
}

/** Re-reads a value whenever any preference changes, locally or from the server. */
function usePreferenceValue<T>(read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => subscribeToUserPreferences(() => setValue(read())), [read]);
  return value;
}

export const useWorkspaceFonts = (): WorkspaceFonts => usePreferenceValue(readWorkspaceFonts);
export const useWorkspaceProfile = (): WorkspaceProfile => usePreferenceValue(readWorkspaceProfile);

/** Puts the chosen fonts on <html>, where workspace-theme.css turns them into font stacks. */
export function applyWorkspaceFonts(fonts: WorkspaceFonts): void {
  document.documentElement.dataset.uiFont = fonts.uiFont;
  document.documentElement.dataset.chatFont = fonts.chatFont;
}
