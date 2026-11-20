import { render } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { ChatHomeGreeting } from '@/modules/chat/ChatHomeGreeting';
import { i18n } from '@/modules/i18n';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

const account = vi.hoisted(() => ({ user: { username: 'alex' } as { username: string } | null }));
vi.mock('@/modules/auth', () => ({ useAuth: () => account }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); account.user = { username: 'alex' }; resetUserPreferences(); await i18n.changeLanguage('en'); });

// Daytime choices: happyDay, coffee, ideas, thinkThrough. From 22:00 to 06:00 moonlight replaces coffee and lateNight is added.
const greetingAt = (hour: number, random: number) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 15, hour));
  vi.spyOn(Math, 'random').mockReturnValue(random);
  const view = render(<ChatHomeGreeting />);
  const text = view.getByRole('heading').textContent;
  view.unmount();
  return text;
};

it('uses the profile and local weekday, has no icon, and keeps the same greeting while typing', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 15, 10));
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  writeUserPreference('workspaceProfile', { displayName: 'Alex Chen' });
  const view = render(<ChatHomeGreeting key={0} />);
  expect(view.getByRole('heading').textContent).toBe('Happy Sunday, Alex Chen');
  expect(view.container.querySelector('svg')).toBeNull();
  random.mockReturnValue(0.3);
  view.rerender(<ChatHomeGreeting key={0} />);
  expect(view.getByRole('heading').textContent).toBe('Happy Sunday, Alex Chen');
  view.rerender(<ChatHomeGreeting key={1} />);
  expect(view.getByRole('heading').textContent).toBe('Coffee and Claude time?');
});

it('uses the signed-in username when no profile name is set', () => {
  expect(greetingAt(10, 0.5)).toBe("What's on your mind, alex?");
  expect(greetingAt(10, 0.9)).toBe('What shall we think through?');
});

it('writes the weekday greeting in Chinese and never adds a name to the mood greetings', async () => {
  await i18n.changeLanguage('zh-CN');
  expect(greetingAt(10, 0)).toBe('星期日愉快，alex');
  expect(greetingAt(10, 0.3)).toBe('咖啡与 Claude 时光？');
  expect(greetingAt(23, 0.3)).toBe('月光下的对话');
  expect(greetingAt(23, 0.9)).toBe('深夜即兴时刻');
  account.user = null;
  expect(greetingAt(20, 0)).toBe('星期日愉快');
  await i18n.changeLanguage('zh-TW');
  expect(greetingAt(2, 0.9)).toBe('深夜即興時刻');
});

it('offers late-night improv only between 22:00 and 06:00', () => {
  expect(greetingAt(21, 0.99)).toBe('What shall we think through?');
  expect(greetingAt(22, 0.99)).toBe('Late-night improv time');
  expect(greetingAt(5, 0.99)).toBe('Late-night improv time');
  expect(greetingAt(6, 0.99)).toBe('What shall we think through?');
});
