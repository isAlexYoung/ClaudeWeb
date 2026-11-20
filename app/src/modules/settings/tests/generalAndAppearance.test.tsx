import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, test } from 'vitest';

import { readTranscriptAppearance, writeTranscriptAppearance, applyTranscriptAppearance } from '@/shared/utils';
import { i18n } from '@/modules/i18n';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import {
  applyWorkspaceFonts,
  readWorkspaceFonts,
  readWorkspaceProfile,
  writeWorkspaceFonts,
} from '@/shared/workspacePreferences';
import SettingsSidebar from '@/modules/settings/SettingsSidebar';
import AboutTab from '@/modules/settings/tabs/AboutTab';

/**
 * Settings round of 2026-11-14: General replaces Agents at the top, voice and
 * browser are gone, the profile only labels the bottom-left account button,
 * fonts are an appearance choice, and About points at CloudCLI.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  resetUserPreferences();
});

test('fonts default to Inter for the interface and Source Serif for replies, and ignore unknown values', () => {
  assert.deepEqual(readWorkspaceFonts(), { uiFont: 'inter', chatFont: 'serif' });

  writeUserPreference('workspaceFonts', { uiFont: 'comic-sans', chatFont: 'system' });
  assert.deepEqual(readWorkspaceFonts(), { uiFont: 'inter', chatFont: 'system' });

  writeWorkspaceFonts({ uiFont: 'system' });
  assert.deepEqual(readWorkspaceFonts(), { uiFont: 'system', chatFont: 'system' });

  applyWorkspaceFonts(readWorkspaceFonts());
  assert.equal(document.documentElement.dataset.uiFont, 'system');
  assert.equal(document.documentElement.dataset.chatFont, 'system');
});

test('the profile keeps only an image data URL as the avatar and trims the name to 40 characters', () => {
  writeUserPreference('workspaceProfile', { displayName: 'x'.repeat(60), avatar: 'https://example.com/me.png' });
  const profile = readWorkspaceProfile();
  assert.equal(profile.displayName.length, 40);
  assert.equal(profile.avatar, null, 'a remote URL is never rendered');
});

test('settings open on General, and voice and browser are no longer offered', () => {
  render(<SettingsSidebar activeTab="agents" onChange={() => {}} />);
  const labels = screen.getAllByRole('button').map((button) => button.textContent?.trim());

  assert.equal(labels[0], 'General');
  assert.ok(!labels.includes('Voice'));
  assert.ok(!labels.includes('Browser'));
});

test('About says what the interface is built on and links to CloudCLI, with the license notice', () => {
  const { container } = render(<AboutTab />);
  const link = screen.getByRole('link', { name: /CloudCLI on GitHub/ });

  assert.equal(link.getAttribute('href'), 'https://github.com/siteboon/claudecodeui');
  assert.match(container.textContent ?? '', /built on the open-source project CloudCLI/);
  assert.match(container.textContent ?? '', /AGPL-3\.0/);
  assert.doesNotMatch(container.textContent ?? '', /Discord|Star on GitHub|Pro Features/);
});


test('reading preferences normalize old values, retain independent choices and apply without resizing UI fonts', () => {
  writeUserPreference('transcriptAppearance', { textSize: 'huge', lineSpacing: 'relaxed', width: 'wide' });
  assert.deepEqual(readTranscriptAppearance(), { textSize: 'medium', sideChatTextSize: 'auto', lineSpacing: 'relaxed', width: 'wide' });
  writeTranscriptAppearance({ textSize: 'large' });
  applyTranscriptAppearance(readTranscriptAppearance());
  assert.equal(document.documentElement.dataset.transcriptSize, 'large');
  assert.equal(document.documentElement.dataset.transcriptSpacing, 'relaxed');
  assert.equal(document.documentElement.dataset.transcriptWidth, 'wide');
  assert.equal(readTranscriptAppearance().lineSpacing, 'relaxed');
  writeTranscriptAppearance({ sideChatTextSize: 'large' });
  applyTranscriptAppearance(readTranscriptAppearance());
  assert.equal(document.documentElement.dataset.sideChatTextSize, 'large');
});
