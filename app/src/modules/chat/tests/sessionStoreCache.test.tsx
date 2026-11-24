import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

/**
 * The session store outlives the chat: leaving it for Scheduled tasks or
 * Plugins unmounts the chat, and the conversations it had loaded must still be
 * there when it comes back, without asking the server for them again.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const row = (id: string, content: string): NormalizedMessage => ({
  id,
  kind: 'text',
  role: 'assistant',
  provider: 'claude',
  sessionId: 'session-1',
  content,
  timestamp: `2026-01-01T00:00:0${id}.000Z`,
} as NormalizedMessage);

const HISTORY = [row('1', 'first answer'), row('2', 'second answer')];

beforeEach(() => {
  sessionMessages.mockReset();
  sessionMessages.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { messages: HISTORY, total: HISTORY.length, hasMore: false } }),
  });
});

afterEach(() => {
  vi.resetModules();
});

async function importStore() {
  const storeModule = await import('@/modules/chat/hooks/useSessionStore');
  const cacheModule = await import('@/shared/sessionCache');
  return { ...storeModule, ...cacheModule };
}

describe('session message cache', () => {
  it('keeps a loaded conversation after the chat unmounts and mounts again', async () => {
    const { useSessionStore } = await importStore();
    const first = renderHook(() => useSessionStore());
    await act(async () => {
      await first.result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });
    first.unmount();

    const second = renderHook(() => useSessionStore());
    assert.deepEqual(second.result.current.getMessages('session-1').map((message) => message.id), ['1', '2']);
    assert.ok(second.result.current.getSessionSlot('session-1')?.fetchedAt);
    assert.equal(sessionMessages.mock.calls.length, 1);
  });

  it('drops a half-streamed reply the unmounted chat could never finish', async () => {
    const { useSessionStore } = await importStore();
    const first = renderHook(() => useSessionStore());
    act(() => {
      first.result.current.updateStreaming('session-1', 'Partial rep', 'claude');
    });
    assert.equal(first.result.current.getMessages('session-1').length, 1);
    first.unmount();

    const second = renderHook(() => useSessionStore());
    assert.equal(second.result.current.getMessages('session-1').length, 0);
  });

  it('keeps only the most recently opened conversations', async () => {
    const { useSessionStore, readCachedSessionIds, MAX_CACHED_SESSIONS } = await importStore();
    const view = renderHook(() => useSessionStore());
    act(() => {
      for (let index = 0; index <= MAX_CACHED_SESSIONS; index += 1) {
        const sessionId = `session-${index}`;
        view.result.current.appendRealtime(sessionId, { ...row('1', 'hi'), sessionId });
        view.result.current.setActiveSession(sessionId);
      }
    });

    const cached = readCachedSessionIds();
    assert.equal(cached.length, MAX_CACHED_SESSIONS);
    assert.ok(!cached.includes('session-0'), 'the least recently opened conversation is the one dropped');
    assert.ok(cached.includes(`session-${MAX_CACHED_SESSIONS}`));
  });

  it('is cleared when the account signs out', async () => {
    const { useSessionStore, resetSessionCaches, readCachedSessionIds } = await importStore();
    const view = renderHook(() => useSessionStore());
    await act(async () => {
      await view.result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });
    resetSessionCaches();
    assert.deepEqual(readCachedSessionIds(), []);
    assert.equal(view.result.current.getMessages('session-1').length, 0);
  });
});
