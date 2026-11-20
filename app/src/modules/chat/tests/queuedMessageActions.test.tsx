import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import QueuedMessageCard from '@/modules/chat/composer/QueuedMessageCard';

test('queue card explains timing, edits in place and exposes cancel and interrupt actions', async () => {
  await i18n.changeLanguage('en');
  const save = vi.fn(async () => {}), send = vi.fn(), edit = vi.fn();
  const view = render(<QueuedMessageCard content="original" attachmentCount={2} onEdit={edit} onDelete={vi.fn()} onSave={save} onSendNow={send} />);
  view.getByText('Will send after the current reply finishes');
  fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'updated with attachments retained' } });
  assert.equal(view.queryByRole('button', { name: 'Interrupt and send' }), null);
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => assert.ok(view.queryByRole('textbox') === null));
  assert.deepEqual(save.mock.calls, [['updated with attachments retained']]);
  assert.equal(edit.mock.calls.length, 0);
  fireEvent.click(view.getByRole('button', { name: 'Interrupt and send' }));
  assert.equal(send.mock.calls.length, 1);
  fireEvent.click(view.getByRole('button', { name: 'Cancel queued message' }));
  await waitFor(() => assert.deepEqual(save.mock.calls[1], [null]));
});

test('queue request failure keeps edited text and disables duplicate actions while sending', async () => {
  await i18n.changeLanguage('en');
  const props = { content: 'waiting', onEdit: vi.fn(), onDelete: vi.fn(), onSendNow: vi.fn(), onSave: vi.fn(async () => { throw Error('conflict'); }) };
  const view = render(<QueuedMessageCard {...props} />);
  fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'keep this text' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => assert.equal(props.onSave.mock.calls.length, 1));
  view.rerender(<QueuedMessageCard {...props} error="Queue changed" sending />);
  assert.equal((view.getByRole('textbox') as HTMLTextAreaElement).value, 'keep this text');
  view.getByRole('alert');
  for (const button of view.getAllByRole('button')) assert.equal((button as HTMLButtonElement).disabled, true);
});
