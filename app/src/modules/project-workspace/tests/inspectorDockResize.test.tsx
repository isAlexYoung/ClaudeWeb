import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, test } from 'vitest';

import WorkspaceInspectorDock from '@/modules/project-workspace/WorkspaceInspectorDock';
import '@/modules/i18n';

beforeEach(() => localStorage.removeItem('workspace-inspector-width'));

test('right dock supports keyboard resize, persistence, width limits and restoring its default', () => {
  const view = render(<div><WorkspaceInspectorDock mobile={false}><aside /></WorkspaceInspectorDock></div>);
  const handle = view.getByRole('separator');
  const dock = handle.parentElement!;
  Object.defineProperty(dock.parentElement, 'clientWidth', { value: 1400 });
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  assert.equal(dock.style.width, '308px');
  assert.equal(localStorage.getItem('workspace-inspector-width'), '308');
  for (let i = 0; i < 30; i++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
  assert.equal(dock.style.width, '240px');
  fireEvent.doubleClick(handle);
  assert.equal(dock.style.width, '292px');
});

test('mobile inspector consumes no dock width or desktop resize handle', () => {
  const view = render(<WorkspaceInspectorDock mobile><aside data-testid="inspector" /></WorkspaceInspectorDock>);
  assert.equal(view.queryByRole('separator'), null);
  assert.equal(view.container.firstElementChild?.className, 'workspace-mobile-inspector');
  assert.equal(view.container.firstElementChild?.firstElementChild, view.getByTestId('inspector'));
});
