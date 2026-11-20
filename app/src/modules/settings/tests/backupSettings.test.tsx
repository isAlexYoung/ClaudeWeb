import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { BackupImportStatus } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  prepareExport: vi.fn(),
  createImport: vi.fn(),
  uploadChunk: vi.fn(),
  status: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@/shared/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  api: {
    backup: {
      ...mocks,
      downloadUrl: (downloadId: string) => `/api/backup-download/${downloadId}`,
    },
    // Changing the language saves it as a preference.
    user: { savePreferences: vi.fn(async () => new Response('{}')) },
  },
}));
const { default: BackupSettingsTab } = await import('@/modules/settings/tabs/backup-settings/BackupSettingsTab');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function importStatus(overrides: Partial<BackupImportStatus>): BackupImportStatus {
  return {
    importId: 'imp-1', state: 'reading', size: 10, received: 10, encrypted: null,
    error: null, progress: null, preview: null, result: null, ...overrides,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  mocks.cancel.mockResolvedValue(json({ cancelled: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('export checks the password locally, then starts a one-time download', async () => {
  const clicked: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(`${this.getAttribute('href')} ${this.download}`);
  });
  mocks.prepareExport.mockResolvedValue(json({ downloadId: 'dl-1', fileName: 'claude-backup-2026-11-14.tar.gz.enc' }));
  render(<BackupSettingsTab />);

  fireEvent.click(screen.getByRole('switch', { name: 'Protect with a password' }));
  fireEvent.change(screen.getByLabelText('Password (at least 8 characters)'), { target: { value: 'long password' } });
  fireEvent.change(screen.getByLabelText('Repeat the password'), { target: { value: 'other password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export all conversations' }));
  expect(await screen.findByText('The two passwords do not match.')).toBeTruthy();
  expect(mocks.prepareExport).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Repeat the password'), { target: { value: 'long password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export all conversations' }));
  expect(await screen.findByText(/Downloading claude-backup-2026-11-14\.tar\.gz\.enc/)).toBeTruthy();
  expect(mocks.prepareExport).toHaveBeenCalledWith('long password');
  expect(clicked).toEqual(['/api/backup-download/dl-1 claude-backup-2026-11-14.tar.gz.enc']);
  // The password fields are cleared once the download has started.
  expect((screen.getByLabelText('Password (at least 8 characters)') as HTMLInputElement).value).toBe('');
});

test('import uploads in pieces, asks for the password, previews and imports the chosen projects', async () => {
  mocks.createImport.mockResolvedValue(json({ importId: 'imp-1', chunkSize: 4 }));
  mocks.uploadChunk.mockResolvedValue(json({ received: 4 }));
  mocks.preview
    .mockResolvedValueOnce(json(importStatus({
      state: 'password', encrypted: true, error: { code: 'BACKUP_PASSWORD_REQUIRED', message: '' },
    })))
    .mockResolvedValueOnce(json(importStatus({
      state: 'ready',
      encrypted: true,
      preview: {
        createdAt: '2026-11-01T00:00:00.000Z',
        sourceHome: '/home/wdguest',
        encrypted: true,
        sharedNewBytes: 1024,
        freeBytes: 10 * 1024 * 1024 * 1024,
        projects: [
          { id: '-home-wdguest-app', name: 'app', path: '/home/wdguest/app', pathExists: true, sessionCount: 3, existingSessionCount: 1, newBytes: 2048 },
          { id: '-srv-site', name: 'site', path: '/srv/site', pathExists: false, sessionCount: 1, existingSessionCount: 0, newBytes: 512 },
        ],
      },
    })));
  mocks.apply.mockResolvedValue(json(importStatus({ state: 'importing', progress: { processedBytes: 2, totalBytes: 10 } })));
  mocks.status.mockResolvedValue(json(importStatus({
    state: 'done',
    result: { restoredSessions: 2, skippedExistingSessions: 1, restoredFiles: 5, skippedExistingFiles: 1 },
  })));

  const { container } = render(<BackupSettingsTab />);
  const file = new File(['0123456789'], 'claude-backup-2026-11-01.tar.gz.enc');
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });

  expect(await screen.findByText('This backup is protected with a password')).toBeTruthy();
  expect(mocks.createImport).toHaveBeenCalledWith(10);
  expect(mocks.uploadChunk.mock.calls.map((call) => [call[0], call[1], (call[2] as Blob).size])).toEqual([
    ['imp-1', 0, 4], ['imp-1', 1, 4], ['imp-1', 2, 2],
  ]);

  fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'secret pass' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  expect(await screen.findByText('/home/wdguest/app')).toBeTruthy();
  expect(mocks.preview).toHaveBeenLastCalledWith('imp-1', 'secret pass');
  expect(screen.getByText('2 conversations to import · 1 already here, skipped')).toBeTruthy();
  expect(screen.getByText(/This folder does not exist on this server/)).toBeTruthy();

  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 project' }));
  expect(mocks.apply).toHaveBeenCalledWith('imp-1', ['-home-wdguest-app']);
  expect(await screen.findByText('Importing…')).toBeTruthy();
  await waitFor(() => expect(screen.getByText('Imported 2 conversations.')).toBeTruthy(), { timeout: 3000 });
  expect(screen.getByText('Skipped 1 conversation that was already here.')).toBeTruthy();
});

test('a refused archive explains why and lets the user choose again', async () => {
  mocks.createImport.mockResolvedValue(json({ importId: 'imp-1', chunkSize: 1024 }));
  mocks.uploadChunk.mockResolvedValue(json({ received: 3 }));
  mocks.preview.mockResolvedValue(json(importStatus({ state: 'reading' })));
  mocks.status.mockResolvedValue(json(importStatus({
    state: 'failed', error: { code: 'BACKUP_UNSAFE_ENTRY', message: 'unsafe' },
  })));
  const { container } = render(<BackupSettingsTab />);
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['abc'], 'evil.tar.gz')] },
    });
  });
  await waitFor(() => expect(screen.getByText(/cannot be restored safely, so nothing was imported/)).toBeTruthy(), { timeout: 3000 });
  fireEvent.click(screen.getByRole('button', { name: 'Choose a file again' }));
  expect(mocks.cancel).toHaveBeenCalledWith('imp-1');
  expect(screen.getByText('Drop the backup file here, or click to choose it')).toBeTruthy();
});

test('a full disk is reported before anything is uploaded', async () => {
  mocks.createImport.mockResolvedValue(json({ success: false, error: { code: 'BACKUP_DISK_FULL', message: 'full' } }, 507));
  const { container } = render(<BackupSettingsTab />);
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['abc'], 'claude-backup.tar.gz')] },
    });
  });
  expect(await screen.findByText('There is not enough free disk space on this server.')).toBeTruthy();
  expect(mocks.uploadChunk).not.toHaveBeenCalled();
});
