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

test('banner card fades out and header pill fades in as scrollProgress moves between 0 and 1', () => {
  const onOpen = vi.fn();
  const artefact: ArtefactSummary = {
    id: 'sheet-2',
    kind: 'sheet',
    title: 'Budget',
    sessionId: 'session-2',
    pinned: false,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    openedAt: '2026-11-24T00:00:00.000Z',
  };

  const view = render(
    <div>
      <ArtefactSessionCard variant="banner" artefact={artefact} onOpen={onOpen} scrollProgress={0} />
      <ArtefactSessionCard variant="header" artefact={artefact} onOpen={onOpen} scrollProgress={0} />
    </div>,
  );

  const banner = view.container.querySelector('.artefact-session-banner') as HTMLElement;
  const dock = view.container.querySelector('.artefact-header-dock') as HTMLElement;
  assert.equal(banner.dataset.collapsed, 'false');
  assert.equal(dock.dataset.visible, 'false');
  assert.equal(dock.style.opacity, '0');

  // Scroll down: banner collapses and header pill becomes visible and interactive.
  view.rerender(
    <div>
      <ArtefactSessionCard variant="banner" artefact={artefact} onOpen={onOpen} scrollProgress={1} />
      <ArtefactSessionCard variant="header" artefact={artefact} onOpen={onOpen} scrollProgress={1} />
    </div>,
  );
  assert.equal(banner.dataset.collapsed, 'true');
  assert.equal(banner.style.opacity, '0');
  assert.equal(dock.dataset.visible, 'true');
  assert.equal(dock.style.opacity, '1');

  fireEvent.click(view.container.querySelector('.artefact-header-pill-open') as HTMLElement);
  assert.deepEqual(onOpen.mock.calls, [['sheet-2']]);

  // Scroll back to top: reverse transition restores the banner and hides the header pill.
  view.rerender(
    <div>
      <ArtefactSessionCard variant="banner" artefact={artefact} onOpen={onOpen} scrollProgress={0} />
      <ArtefactSessionCard variant="header" artefact={artefact} onOpen={onOpen} scrollProgress={0} />
    </div>,
  );
  assert.equal(banner.dataset.collapsed, 'false');
  assert.equal(dock.dataset.visible, 'false');
  assert.equal(dock.style.opacity, '0');
});
