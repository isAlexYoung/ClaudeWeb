import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import type { ChatMessage } from '@/shared/types';
import ChatTurnNavigator from '@/modules/chat/transcript/ChatTurnNavigator';

const user = (id: number, content = `User request ${id}`): ChatMessage => ({ id: `u${id}`, type: 'user', content, timestamp: `2026-11-14T10:00:${String(id % 60).padStart(2, '0')}.000Z` });
const props = (messages: ChatMessage[], extra = {}) => ({ messages, scrollContainerRef: { current: document.createElement('div') }, hasOlderMessages: false, loadHistory: vi.fn(async () => messages), onReveal: vi.fn(), ...extra });

function viewportLayout(container: HTMLElement, count: number, height = 120) {
  const viewport = container.querySelector<HTMLElement>('.chat-turn-viewport')!;
  Object.defineProperties(viewport, { clientHeight: { value: height, configurable: true }, scrollHeight: { value: count * 12, configurable: true } });
  fireEvent.scroll(viewport);
  return viewport;
}

describe('Conversation user-turn navigation', () => {
  it('is absent before a real user turn and does not count assistant/tool/summary rows', () => {
    const options = props([{ ...user(1), type: 'assistant' }, { ...user(2), isCompactSummary: true }]);
    const view = render(<ChatTurnNavigator {...options} />);
    expect(screen.queryByRole('navigation')).toBeNull();
    view.rerender(<ChatTurnNavigator {...options} messages={[...options.messages, user(3)]} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('previews real user text and passes the exact stable key on click', () => {
    const options = props([user(1, 'Please inspect the API routes'), { ...user(2), type: 'assistant', content: 'Assistant answer' }]);
    render(<ChatTurnNavigator {...options} />);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').textContent).toContain('Please inspect the API routes');
    expect(screen.getByRole('tooltip').textContent).not.toContain('Assistant answer');
    fireEvent.click(screen.getByRole('button'));
    expect(options.onReveal).toHaveBeenCalledWith(options.messages[0], 'message-user-u1');
  });

  it('shows a genuine history-loading skeleton, deduplicates the request and then displays the text', async () => {
    let finish!: (messages: ChatMessage[]) => void;
    const options = props([user(1)], { hasOlderMessages: true, loadHistory: vi.fn(() => new Promise<ChatMessage[]>(resolve => { finish = resolve; })) });
    const view = render(<ChatTurnNavigator {...options} />);
    const viewport = viewportLayout(view.container, 1);
    fireEvent.mouseEnter(viewport);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('status', { name: 'Loading message preview' })).toBeTruthy();
    expect(options.loadHistory).toHaveBeenCalledOnce();
    await act(async () => finish([user(1)]));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('tooltip').textContent).toContain('User request 1');
  });

  it('allows retry after failed history loading while preserving already known user text', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([user(1)]);
    const view = render(<ChatTurnNavigator {...props([user(1)], { hasOlderMessages: true, loadHistory: load })} />);
    const viewport = viewportLayout(view.container, 1);
    fireEvent.focus(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('could not be loaded'));
    fireEvent.mouseEnter(viewport);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).not.toContain('could not be loaded'));
  });

  it('magnifies nearby bars by distance and moves the wave with the pointer', async () => {
    const view = render(<ChatTurnNavigator {...props([user(1), user(2), user(3), user(4)])} />);
    const viewport = viewportLayout(view.container, 4);
    fireEvent.mouseMove(viewport, { clientY: 18 });
    const markers = () => Array.from(view.container.querySelectorAll<HTMLElement>('.chat-turn-marker'));
    await waitFor(() => expect(Number(markers()[1].style.getPropertyValue('--turn-scale'))).toBeGreaterThan(Number(markers()[0].style.getPropertyValue('--turn-scale'))));
    fireEvent.mouseMove(viewport, { clientY: 30 });
    await waitFor(() => expect(Number(markers()[2].style.getPropertyValue('--turn-scale'))).toBeGreaterThan(Number(markers()[1].style.getPropertyValue('--turn-scale'))));
  });

  it('windows long rails and exposes fade boundaries as the internal scroll moves', () => {
    const view = render(<ChatTurnNavigator {...props(Array.from({ length: 1000 }, (_, i) => user(i)))} />);
    const viewport = viewportLayout(view.container, 1000);
    viewport.scrollTop = 6000;
    fireEvent.scroll(viewport);
    expect(screen.getAllByRole('button').length).toBeLessThan(30);
    expect(viewport.dataset.fadeTop).toBe('true');
    expect(viewport.dataset.fadeBottom).toBe('true');
    expect(view.container.querySelector('[data-turn-index="500"]')).toBeTruthy();
    expect(view.container.querySelector('[data-turn-index="0"]')).toBeNull();
  });

  it('previews attachment-only input without an indefinite skeleton', () => {
    render(<ChatTurnNavigator {...props([{ ...user(1, ''), files: [{ name: 'requirements.pdf', path: '/uploads/requirements.pdf' }] }])} />);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').textContent).toContain('requirements.pdf');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
