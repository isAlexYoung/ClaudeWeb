import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import RecommendedConnectors from '@/modules/plugins/RecommendedConnectors';
import { copyTextToClipboard } from '@/shared/utils';

vi.mock('@/shared/utils', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), copyTextToClipboard: vi.fn() }));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.mocked(copyTextToClipboard).mockReset();
});

it('offers a selectable entry URL, copies it, and opens the persistent browser without an automatic popup', async () => {
  const openBrowser = vi.fn();
  vi.mocked(copyTextToClipboard).mockResolvedValue(true);
  render(<RecommendedConnectors query="" onOpenBrowser={openBrowser} />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail' }));
  const dialog = screen.getByRole('dialog');
  const link = within(dialog).getByRole('textbox', { name: 'Connection link' }) as HTMLInputElement;
  expect(link.readOnly).toBe(true);
  expect(link.value).toBe('https://claude.ai/customize/connectors');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
  await waitFor(() => expect(within(dialog).getByRole('status').textContent).toMatch(/Link copied/));
  expect(copyTextToClipboard).toHaveBeenCalledWith(link.value);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Open built-in browser' }));
  expect(openBrowser).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('retains a manually copyable link when clipboard permission is denied', async () => {
  vi.mocked(copyTextToClipboard).mockResolvedValue(false);
  render(<RecommendedConnectors query="Microsoft" />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Microsoft 365' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Select the link above/));
  expect((screen.getByRole('textbox', { name: 'Connection link' }) as HTMLInputElement).value).toBe('https://claude.ai/customize/connectors');
  expect(screen.getByText(/Organization accounts may require/)).toBeTruthy();
});
