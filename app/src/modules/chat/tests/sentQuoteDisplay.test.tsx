import { expect, beforeAll, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { i18n } from '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { TranscriptSessionContext } from '@/modules/chat/context/TranscriptSessionContext';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { formatQuotedQuestion } from '@/shared/utils';
import type { TextQuote } from '@/shared/types';

beforeAll(async () => { await i18n.changeLanguage('zh-CN'); });
const quote: TextQuote = { id: 'q1', text: '原文 <script>不是 HTML</script>', role: 'assistant', kind: 'text', messageKey: 'source-key', startOffset: 0, timestamp: '2026-11-18T10:00:00Z' };

test('a sent message displays compact numbered references, previews exact text and jumps within its own session', () => {
  const jump = vi.fn();
  window.addEventListener('claudeweb:quote-jump', jump);
  try {
    render(<UiPreferencesProvider><TranscriptSessionContext.Provider value={{ sessionId: 'main-123' }}>
      <MessageComponent message={{ type: 'user', content: formatQuotedQuestion('这是我的问题', [quote, { ...quote, id: 'q2', text: '第二处原文' }]), timestamp: quote.timestamp }} prevMessage={null} createDiff={() => []} provider="claude" />
    </TranscriptSessionContext.Provider></UiPreferencesProvider>);
    expect(screen.getByText('这是我的问题')).toBeTruthy();
    expect(document.body.textContent).not.toContain('quoted_excerpts');
    expect(document.body.textContent).not.toContain('ClaudeWeb 引用');
    expect(screen.queryByText(quote.text)).toBeNull();
    const first = screen.getByRole('button', { name: '第一条引用' });
    expect(screen.getByRole('button', { name: '第二条引用' })).toBeTruthy();
    fireEvent.mouseEnter(first);
    expect(screen.getByRole('tooltip').textContent).toBe(quote.text);
    expect(screen.getByRole('tooltip').querySelector('script')).toBeNull();
    fireEvent.resize(window);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(first);
    expect(screen.getByRole('tooltip').textContent).toBe(quote.text);
    fireEvent.click(first);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jump.mock.calls[0][0].detail).toMatchObject({ parentSessionId: 'main-123', source: { text: quote.text, messageKey: quote.messageKey } });
    expect(screen.queryByRole('tooltip')).toBeNull();
  } finally { window.removeEventListener('claudeweb:quote-jump', jump); }
});

test('copying a quoted user turn contains only its excerpts and question', async () => {
  const writeText = vi.fn(async () => {});
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    const view = render(<UiPreferencesProvider><MessageComponent message={{ type: 'user', content: formatQuotedQuestion('我的问题', [{ ...quote, text: '选中的原文' }]), timestamp: quote.timestamp }} prevMessage={null} createDiff={() => []} provider="claude" /></UiPreferencesProvider>);
    await act(async () => fireEvent.click(view.container.querySelector('.workspace-user-actions button')!));
    expect(writeText).toHaveBeenCalledWith('选中的原文\n\n我的问题');
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor); else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
