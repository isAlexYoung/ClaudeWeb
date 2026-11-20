import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';

const mocks = vi.hoisted(() => ({
  status: { authenticated: false, loading: false, email: null, method: null, error: null },
  complete: vi.fn(),
  check: vi.fn(async () => {}),
}));
vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { user: { completeOnboarding: mocks.complete } },
}));
vi.mock('@/modules/provider-auth', () => ({
  ProviderLoginModal: () => null,
  useProviderAuthStatus: () => ({
    providerAuthStatus: { claude: mocks.status },
    checkProviderAuthStatus: mocks.check,
  }),
}));
const { Onboarding } = await import('@/modules/onboarding');

beforeEach(() => {
  mocks.status = { authenticated: false, loading: false, email: null, method: null, error: null };
  mocks.complete.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  mocks.check.mockClear();
});

describe('Claude-only onboarding', () => {
  it('offers login and skip without requesting or requiring any Git configuration', async () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);
    expect(screen.queryByLabelText(/Git/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Login' })).toBeTruthy();
    expect(mocks.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in later' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });
  it('auto-completes an existing VPS login once, including in StrictMode', async () => {
    mocks.status.authenticated = true;
    const onComplete = vi.fn();
    render(<StrictMode><Onboarding onComplete={onComplete} /></StrictMode>);
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Login' })).toBeNull();
  });
  it('waits for the VPS authentication check before displaying the login choice', () => {
    mocks.status.loading = true;
    render(<Onboarding />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('reports completion errors and permits a retry', async () => {
    mocks.complete.mockResolvedValueOnce(new Response(JSON.stringify({
      success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not save your choice' },
    }), { status: 500 }));
    render(<Onboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in later' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save your choice');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in later' }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2));
  });
  it('auto-enters after the login status becomes authenticated', async () => {
    const view = render(<Onboarding />);
    mocks.status = { ...mocks.status, authenticated: true };
    view.rerender(<Onboarding />);
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
  });
});
