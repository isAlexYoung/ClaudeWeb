import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import YourClaudeSettingsTab from '@/modules/settings/tabs/YourClaudeSettingsTab';
import ClaudeNameField from '@/modules/settings/tabs/agents-settings/ClaudeNameField';

/** Settings > Your Claude saves the name and the CLI memory switches through one endpoint. */

const state = {
  name: '',
  outputStyle: null as string | null,
  outputStyles: [
    { name: 'Explanatory', description: 'x', builtIn: true },
    { name: 'Learning', description: 'x', builtIn: true },
    { name: 'Proactive', description: 'x', builtIn: true },
    { name: 'Terse', description: 'Short answers', builtIn: false },
  ],
  autoMemoryEnabled: null as boolean | null,
  autoMemoryDirectory: null as string | null,
  autoDreamEnabled: null as boolean | null,
  settingsStatus: 'ok',
  settingsPath: '/home/claudeweb/.claude/settings.json',
  claudeMdPath: '/home/claudeweb/.claude/CLAUDE.md',
};
const api = vi.hoisted(() => ({ yourClaude: vi.fn(), updateYourClaude: vi.fn() }));
vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { providers: api } };
});

const respond = (body: unknown, ok = true) => Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 409 }));

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  Object.assign(state, { name: '', outputStyle: null, autoMemoryEnabled: null, autoMemoryDirectory: null, autoDreamEnabled: null, settingsStatus: 'ok' });
  api.yourClaude.mockImplementation(() => respond({ success: true, data: { ...state } }));
  api.updateYourClaude.mockImplementation((update: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(update)) (state as Record<string, unknown>)[key] = value;
    return respond({ success: true, data: { ...state } });
  });
});

it('shows CLI defaults and saves switches on Your Claude, keeping the name in Account', async () => {
  render(<YourClaudeSettingsTab />);
  const autoMemory = await screen.findByRole('switch', { name: 'Auto memory' });
  expect(autoMemory.getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('switch', { name: 'Tidy memory in the background' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText(/Not set: Claude decides by default/)).toBeTruthy();

  expect(screen.queryByLabelText('What should Claude call you?')).toBeNull();

  fireEvent.click(autoMemory);
  await waitFor(() => expect(api.updateYourClaude).toHaveBeenLastCalledWith({ autoMemoryEnabled: false }));
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Auto memory' }).getAttribute('aria-checked')).toBe('false'));

  fireEvent.click(screen.getByRole('switch', { name: 'Tidy memory in the background' }));
  await waitFor(() => expect(api.updateYourClaude).toHaveBeenLastCalledWith({ autoDreamEnabled: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use default' }));
  await waitFor(() => expect(api.updateYourClaude).toHaveBeenLastCalledWith({ autoDreamEnabled: null }));
});

it('an empty memory folder is saved as the default', async () => {
  state.autoMemoryDirectory = '~/notes';
  render(<YourClaudeSettingsTab />);
  const input = await screen.findByLabelText('Memory folder');
  fireEvent.change(input, { target: { value: '  ' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(api.updateYourClaude).toHaveBeenCalledWith({ autoMemoryDirectory: null }));
});

it('locks the memory switches while settings.json is invalid', async () => {
  state.settingsStatus = 'invalid';
  render(<YourClaudeSettingsTab />);
  expect(await screen.findByText(/is not valid JSON/)).toBeTruthy();
  expect((screen.getByRole('switch', { name: 'Auto memory' }) as HTMLButtonElement).disabled).toBe(true);
});

it('saves the Claude name from Account on blur without writing on every keystroke', async () => {
  render(<ClaudeNameField />);
  const input = screen.getByRole('textbox', { name: 'What should Claude call you?' }) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  api.updateYourClaude.mockClear();
  fireEvent.change(input, { target: { value: 'Alex' } });
  expect(api.updateYourClaude).not.toHaveBeenCalled();
  fireEvent.blur(input);
  await waitFor(() => expect(api.updateYourClaude).toHaveBeenCalledWith({ name: 'Alex' }));
  await screen.findByText('Saved');
  fireEvent.blur(input);
  expect(api.updateYourClaude).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/CLAUDE.md/)).toBeNull();
});

it('keeps the Account name editable when the separate CLI settings JSON is invalid', async () => {
  state.settingsStatus = 'invalid';
  render(<ClaudeNameField />);
  const input = screen.getByRole('textbox', { name: 'What should Claude call you?' }) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  input.focus();
  fireEvent.change(input, { target: { value: 'Alex' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(api.updateYourClaude).toHaveBeenLastCalledWith({ name: 'Alex' }));
});

it('picks an output style from the built-ins and style files, and Default clears it', async () => {
  render(<YourClaudeSettingsTab />);
  const select = await screen.findByRole('combobox', { name: 'Output style' }) as HTMLSelectElement;
  expect([...select.options].map((option) => option.textContent)).toEqual(['Default', 'Explanatory', 'Learning', 'Proactive', 'Terse']);
  fireEvent.change(select, { target: { value: 'Terse' } });
  await waitFor(() => expect(api.updateYourClaude).toHaveBeenLastCalledWith({ outputStyle: 'Terse' }));
  await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
  fireEvent.change(screen.getByRole('combobox', { name: 'Output style' }), { target: { value: '' } });
  await waitFor(() => expect(api.updateYourClaude).toHaveBeenLastCalledWith({ outputStyle: null }));
});

it('describes the chosen style file with its own description', async () => {
  state.outputStyle = 'Terse';
  render(<YourClaudeSettingsTab />);
  expect(await screen.findByText('Short answers')).toBeTruthy();
});

it('keeps a style the list does not know, with a warning', async () => {
  state.outputStyle = 'FromPlugin';
  render(<YourClaudeSettingsTab />);
  const select = await screen.findByRole('combobox', { name: 'Output style' }) as HTMLSelectElement;
  expect(select.value).toBe('FromPlugin');
  expect(screen.getByText(/not in the list/)).toBeTruthy();
});
