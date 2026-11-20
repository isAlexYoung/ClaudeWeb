import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import MessageTime from '@/modules/chat/transcript/MessageTime';
import { formatExactTime } from '@/shared/timeFormat';

/** A message's time reads "just now" / "30 minutes ago"; resting on it shows the exact minute and time zone. */

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.useRealTimers();
});

test('a recent message says just now, an older one how long ago, with no seconds', () => {
  const now = Date.now();
  const recent = render(<MessageTime timestamp={new Date(now - 20_000).toISOString()} />);
  assert.equal(recent.container.textContent, 'Just now');
  recent.unmount();

  const older = render(<MessageTime timestamp={new Date(now - (2 * 3600_000 + 40 * 60_000))} />);
  assert.equal(older.container.textContent, '2 hours ago');
  older.unmount();
});

test('resting the pointer on the time shows the exact date and minute', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const timestamp = new Date(Date.now() - 30 * 60_000);
  render(<MessageTime timestamp={timestamp} />);
  const label = screen.getByText('30 minutes ago');
  fireEvent.mouseEnter(label.parentElement!);
  await act(async () => { vi.advanceTimersByTime(400); });
  assert.ok(screen.getByText(formatExactTime(timestamp, 'en')));
});

test('an exported transcript carries the exact time, and a missing time renders nothing', () => {
  const timestamp = new Date(2026, 10, 15, 23, 34);
  const exported = render(<MessageTime timestamp={timestamp} exact />);
  assert.equal(exported.container.textContent, formatExactTime(timestamp, 'en'));
  exported.unmount();

  const empty = render(<MessageTime timestamp={undefined} />);
  assert.equal(empty.container.textContent, '');
});
