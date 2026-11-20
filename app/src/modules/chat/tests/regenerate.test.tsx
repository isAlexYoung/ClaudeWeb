import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { findRegenerateTarget } from '@/modules/chat/utils/regenerateTarget';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage } from '@/shared/types';

/** Regenerate runs the last user message again; it sits under the reply that ends the conversation. */

beforeAll(async () => { await i18n.changeLanguage('en'); });

const user = (id: string, anchor?: string): ChatMessage => ({ type: 'user', content: `ask ${id}`, timestamp: '2026-11-16T10:00:00.000Z', transcriptAnchorId: anchor });
const reply = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ type: 'assistant', content, timestamp: '2026-11-16T10:01:00.000Z', ...extra });

describe('which reply offers Regenerate', () => {
  it('is the last finished reply after the last re-runnable user message', () => {
    const first = user('1', 'a1');
    const last = user('2', 'a2');
    const answer = reply('final answer');
    const messages = [first, reply('old'), last, reply('', { isThinking: true }), reply('step', { isToolUse: true }), answer];
    expect(findRegenerateTarget(messages)).toEqual({ reply: answer, from: last });
  });

  it('is nothing while the reply streams, without a reply, or for a message that cannot be re-run', () => {
    expect(findRegenerateTarget([user('1', 'a1'), reply('typing', { isStreaming: true })])).toBeNull();
    expect(findRegenerateTarget([user('1', 'a1')])).toBeNull();
    expect(findRegenerateTarget([user('1'), reply('answer')])).toBeNull();
    expect(findRegenerateTarget([])).toBeNull();
  });
});

describe('the Regenerate button', () => {
  const renderReply = (props: Partial<Parameters<typeof MessageComponent>[0]> = {}) => render(
    <UiPreferencesProvider>
      <MessageComponent message={reply('final answer')} prevMessage={null} createDiff={() => []} provider="claude" {...props} />
    </UiPreferencesProvider>,
  );

  it('runs the user message it was given again', () => {
    const from = user('2', 'a2');
    const onRegenerateMessage = vi.fn();
    renderReply({ regenerateFrom: from, onRegenerateMessage });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onRegenerateMessage).toHaveBeenCalledWith(from);
  });

  it('is absent on other replies', () => {
    renderReply();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
  });

  it('an interrupted user turn can be edited once its anchor is synchronized, without an assistant reply', () => {
    const message = user('interrupted', 'interrupted-anchor');
    const onEditMessage = vi.fn();
    renderReply({ message, onEditMessage });
    fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));
    expect(onEditMessage).toHaveBeenCalledWith(message);
  });
});
