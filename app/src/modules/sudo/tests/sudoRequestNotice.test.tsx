import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';

vi.mock('@/shared/context/WebSocketContext', () => ({ useWebSocket: () => ({ subscribe: () => () => {} }) }));

import SudoRequestNotice, { shellLine } from '@/modules/sudo/SudoRequestNotice';

const request = { id: 'req-1', argv: ['apt-get', 'install', '-y', 'htop'], cwd: '/home/claudeweb/project', createdAt: Date.now(), expiresAt: Date.now() + 300_000 };

function stub(requests: unknown[]) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/sudo/requests') return new Response(JSON.stringify({ available: true, requests }), { status: 200 });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const answers = (fetchMock: ReturnType<typeof stub>) => fetchMock.mock.calls
  .filter(([url]) => url === '/api/sudo/requests/req-1')
  .map(([, init]) => JSON.parse(String(init?.body)));

describe('the sudo request card', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the exact command and sends the password only when allowed', async () => {
    const fetchMock = stub([request]);
    render(<SudoRequestNotice />);

    expect(await screen.findByText('sudo apt-get install -y htop')).toBeTruthy();
    expect(screen.getByText(/\/home\/claudeweb\/project/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Enter the sudo password to allow it.');
    expect(answers(fetchMock)).toEqual([]);

    const field = screen.getByPlaceholderText('sudo password') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'secret-sudo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(answers(fetchMock)).toEqual([{ approve: true, password: 'secret-sudo' }]));
    expect(field.value).toBe('');
    expect(JSON.stringify(localStorage)).not.toContain('secret-sudo');
  });

  it('refuses without sending a password', async () => {
    const fetchMock = stub([request]);
    render(<SudoRequestNotice />);
    fireEvent.change(await screen.findByPlaceholderText('sudo password'), { target: { value: 'typed-anyway' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }));
    await waitFor(() => expect(answers(fetchMock)).toEqual([{ approve: false }]));
  });

  it('shows nothing when no request waits, and quotes arguments like a shell', async () => {
    stub([]);
    const { container } = render(<SudoRequestNotice />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(shellLine(['sh', '-c', "echo 'hi' > /etc/x"])).toBe(`sudo sh -c 'echo '\\''hi'\\'' > /etc/x'`);
  });
});
