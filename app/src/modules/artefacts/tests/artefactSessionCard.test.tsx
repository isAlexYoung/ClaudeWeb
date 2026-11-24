import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { beforeAll, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ArtefactSummary } from '@/shared/types';
import ArtefactSessionCard from '@/modules/artefacts/ArtefactSessionCard';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

test('the minimized artefact card opens the full editor on click', () => {
  const onOpen = vi.fn();
  const artefact: ArtefactSummary = {
    id: 'sheet-1',
    kind: 'sheet',
    title: 'Untitled',
    sessionId: 'session-1',
    pinned: false,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    openedAt: '2026-11-24T00:00:00.000Z',
  };

  const view = render(<ArtefactSessionCard artefact={artefact} onOpen={onOpen} />);
  fireEvent.click(view.getByRole('button', { name: /Untitled/ }));
  assert.deepEqual(onOpen.mock.calls, [['sheet-1']]);
  assert.notEqual(view.queryByRole('button', { name: 'Download CSV' }), null);
});
