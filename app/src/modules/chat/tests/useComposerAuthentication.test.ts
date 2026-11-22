import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { api } from '@/shared/api';
import { useComposerAuthentication } from '@/modules/chat/hooks/useComposerAuthentication';

afterEach(() => { vi.restoreAllMocks(); });

it('starts disabled, follows CLI login and logout on focus, and removes its listeners on unmount', async () => {
  let authenticated = false;
  const status = vi.spyOn(api.providers, 'authStatus').mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { authenticated } })));
  const view = renderHook(() => useComposerAuthentication());
  expect(view.result.current).toBe(false);
  await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
  authenticated = true;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(view.result.current).toBe(true));
  authenticated = false;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(view.result.current).toBe(false));
  const calls = status.mock.calls.length;
  view.unmount();
  window.dispatchEvent(new Event('focus'));
  expect(status).toHaveBeenCalledTimes(calls);
});

it('does not query a hidden tab and checks again when it becomes visible', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const status = vi.spyOn(api.providers, 'authStatus').mockResolvedValue(new Response(JSON.stringify({ success: true, data: { authenticated: true } })));
  const view = renderHook(() => useComposerAuthentication());
  expect(status).not.toHaveBeenCalled();
  expect(view.result.current).toBe(false);
  visibility.mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(view.result.current).toBe(true));
  view.unmount();
});
