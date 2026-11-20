import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import { AuthProvider } from '@/modules/auth/context/AuthContext';
import LoginForm from '@/modules/auth/LoginForm';

type StubbedReply = { status: number; body: unknown };

// The login route hands every failure to the global error middleware, which
// answers with the structured AppError envelope; the auth middleware still
// answers with a bare `{ error: 'message' }`.
const envelope = (code: string, message: string, details?: unknown) => ({ success: false, error: { code, message, details } });

const configured = { status: 200, body: { passwordConfigured: true, isAuthenticated: false } };

// `api.auth.*` calls the global fetch directly, so stubbing it drives the
// real AuthProvider without any module mocks.
function stubAuthApi(replies: Record<string, StubbedReply>) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = replies[url] ?? { status: 404, body: { error: 'Not found' } };
    return new Response(
      typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
      { status: reply.status, headers: { 'Content-Type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function submitLogin(password: string) {
  render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('the login page', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks only for the password and sends it alone', async () => {
    const fetchMock = stubAuthApi({
      '/api/auth/status': configured,
      '/api/auth/login': { status: 401, body: envelope('AUTH_INVALID_PASSWORD', 'Wrong password', { attemptsBeforeLock: 4 }) },
    });

    await submitLogin('wrong-password');

    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Wrong password. 4 more tries before a short lockout.');
    const loginCall = fetchMock.mock.calls.find(([url]) => url === '/api/auth/login') as unknown as [string, RequestInit];
    expect(JSON.parse(String(loginCall[1].body))).toEqual({ password: 'wrong-password' });
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });

  it('counts down a lockout and keeps the button disabled until it ends', async () => {
    stubAuthApi({
      '/api/auth/status': configured,
      '/api/auth/login': { status: 429, body: envelope('AUTH_LOCKED', 'Too many failed attempts.', { retryAfterSeconds: 61 }) },
    });

    await submitLogin('wrong-password');

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Too many wrong passwords. Try again in 1:01.');
    expect(screen.getByRole('button', { name: 'Sign In' })).toHaveProperty('disabled', true);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Too many wrong passwords. Try again in 1:00.');
    }, { timeout: 2500 });
  });

  it('says how to set a password when the server has none', async () => {
    stubAuthApi({ '/api/auth/status': { status: 200, body: { passwordConfigured: false, isAuthenticated: false } } });

    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'No login password is set on this server yet. As root, run: claudeweb password --set',
    );
  });

  it('still shows the bare string error the auth middleware sends', async () => {
    stubAuthApi({
      '/api/auth/status': configured,
      '/api/auth/login': { status: 401, body: { error: 'Invalid API key' } },
    });

    await submitLogin('triage-pass-123');

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid API key');
  });

  it('falls back to the localized message when the envelope carries no usable message', async () => {
    stubAuthApi({
      '/api/auth/status': configured,
      '/api/auth/login': { status: 500, body: { success: false, error: { code: 'INTERNAL_ERROR', message: '  ' } } },
    });

    await submitLogin('triage-pass-123');

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Login failed');
  });

  it('falls back to the localized message when the body is not JSON', async () => {
    stubAuthApi({
      '/api/auth/status': configured,
      '/api/auth/login': { status: 502, body: '<html>Bad Gateway</html>' },
    });

    await submitLogin('triage-pass-123');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Login failed');
    });
  });
});
