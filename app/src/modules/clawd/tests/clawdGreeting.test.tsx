import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { UiPreferences } from '@/shared/uiPreferences';

const harness = vi.hoisted(() => ({ insert: vi.fn(), preferences: null as Partial<UiPreferences> | null }));
vi.mock('@/modules/command-palette', () => ({ usePaletteOps: () => ({ insertComposerText: harness.insert }) }));
vi.mock('@/shared/context/UiPreferencesContext', () => ({ useOptionalUiPreferences: () => harness.preferences }));
const { ClawdHeading } = await import('@/modules/clawd');

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
  harness.insert.mockReset();
  harness.preferences = null;
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

const heading = (mode: 'chat' | 'code' = 'chat') => render(<ClawdHeading mode={mode}><h1>What shall we think through?</h1></ClawdHeading>);

test('on a holiday Clawd greets for the day, and the bubble fills in the composer without sending', () => {
  vi.setSystemTime(new Date(2026, 8, 25, 20));
  const view = heading();
  const bubble = view.getByRole('button', { name: '中秋快乐！今晚的月亮一定很圆。' });
  assert.equal(view.container.querySelector('[data-clawd-greeting]')?.getAttribute('data-clawd-greeting'), 'midAutumn');
  fireEvent.click(bubble);
  assert.deepEqual(harness.insert.mock.calls, [['帮我写几条中秋祝福，发给家人和朋友。']]);
  // The heading itself stays as it was.
  assert.ok(view.getByRole('heading', { name: 'What shall we think through?' }));
});

test('a double click switches within the greeting, and a second click never selects text', () => {
  vi.setSystemTime(new Date(2026, 9, 31, 20));
  const view = heading('code');
  const sprite = view.container.querySelector('canvas.clawd-sprite') as HTMLCanvasElement;
  assert.equal(sprite.getAttribute('aria-hidden'), 'true');
  assert.equal(sprite.getAttribute('draggable'), 'false');
  const first = sprite.getAttribute('data-clawd-animation');
  fireEvent.doubleClick(sprite);
  assert.notEqual(sprite.getAttribute('data-clawd-animation'), first);
  const secondDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2 });
  sprite.dispatchEvent(secondDown);
  assert.equal(secondDown.defaultPrevented, true);
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  sprite.dispatchEvent(menu);
  assert.equal(menu.defaultPrevented, true);
});

test('the switches turn off holidays, double click, or Clawd on the new-conversation page', () => {
  vi.setSystemTime(new Date(2026, 8, 25, 9));
  harness.preferences = { clawdOnHome: true, clawdFestivals: false, clawdDoubleClick: false, clawdStill: true };
  const view = heading();
  assert.equal(view.container.querySelector('[data-clawd-greeting]')?.getAttribute('data-clawd-greeting')?.startsWith('chat'), true);
  const sprite = view.container.querySelector('canvas.clawd-sprite') as HTMLCanvasElement;
  const before = sprite.getAttribute('data-clawd-animation');
  fireEvent.doubleClick(sprite);
  assert.equal(sprite.getAttribute('data-clawd-animation'), before);
  view.unmount();

  harness.preferences = { clawdOnHome: false };
  const plain = heading();
  assert.equal(plain.container.querySelector('.clawd-heading'), null);
  assert.equal(plain.container.querySelector('canvas'), null);
  assert.ok(plain.getByRole('heading', { name: 'What shall we think through?' }));
});
