import assert from 'node:assert/strict';

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { WorkspaceVisualPreview } from '@/modules/interactive-preview/WorkspaceVisualPreview';
import { i18n } from '@/modules/i18n';

const { loadWorkspaceVisual } = vi.hoisted(() => ({ loadWorkspaceVisual: vi.fn() }));
vi.mock('@/modules/interactive-preview/utils/workspaceVisual', () => ({ loadWorkspaceVisual }));
beforeEach(async () => { await i18n.changeLanguage('en'); loadWorkspaceVisual.mockReset(); });

test('completed edits and explicit reload re-read the file while stale project responses are ignored', async () => {
  let finishOld: (source: string) => void = () => {};
  loadWorkspaceVisual.mockImplementationOnce(() => new Promise<string>(resolve => { finishOld = resolve; }));
  const view = render(<WorkspaceVisualPreview projectId="old" path="page.html" revision="r1" />);
  await waitFor(() => assert.equal(loadWorkspaceVisual.mock.calls.length, 1));
  const oldSignal = loadWorkspaceVisual.mock.calls[0][2] as AbortSignal;
  loadWorkspaceVisual.mockResolvedValue('<html><body>New visual</body></html>');
  view.rerender(<WorkspaceVisualPreview projectId="new" path="page.html" revision="r2" />);
  await waitFor(() => assert.equal(view.container.querySelector('iframe')?.srcdoc.includes('New visual'), true));
  assert.equal(oldSignal.aborted, true);
  await act(async () => finishOld('<html><body>Wrong project</body></html>'));
  assert.equal(view.container.querySelector('iframe')?.srcdoc.includes('Wrong project'), false);
  view.rerender(<WorkspaceVisualPreview projectId="new" path="page.html" revision="r3" />);
  await waitFor(() => assert.equal(loadWorkspaceVisual.mock.calls.length, 3));
  fireEvent.click(view.getByRole('button', { name: 'Reload file' }));
  await waitFor(() => assert.equal(loadWorkspaceVisual.mock.calls.length, 4));
});
