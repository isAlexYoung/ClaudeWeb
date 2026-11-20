import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import { beforeAll, test, vi } from 'vitest';

import type { PermissionMode } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import ComposerPermissionMenu from '@/modules/chat/composer/ComposerPermissionMenu';

/**
 * The permission control names the mode the next message runs in, in words, so
 * plan mode ("nothing will be changed") and bypass are never a guess.
 */

const MODES: PermissionMode[] = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'];

const renderMenu = (permissionMode: PermissionMode, permissionModes: PermissionMode[] = MODES, onSelect = vi.fn()) =>
  render(
    <ComposerPermissionMenu
      permissionMode={permissionMode}
      permissionModes={permissionModes}
      onSelectPermissionMode={onSelect}
      providerLabel="Claude"
    />,
  );

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

test('the trigger names the mode the next message runs in, visually and accessibly', () => {
  const view = renderMenu('default');
  const trigger = view.getByRole('button', { name: /^Manual:/ });
  assert.equal(trigger.textContent, 'Manual');
  assert.equal(trigger.querySelector('svg'), null);
});

test('every mode the backend reports is offered, bypass permissions included', () => {
  const view = renderMenu('default');
  fireEvent.click(view.getByRole('button'));
  for (const name of ['Manual', 'Auto', 'Accept edits', 'Bypass permissions', 'Plan']) {
    assert.ok(view.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }), `${name} is offered`);
  }
  assert.equal(view.getByRole('menuitemradio', { name: /^Manual/ }).getAttribute('aria-checked'), 'true');
});

test('only backend-supported modes are offered and a choice closes the menu', () => {
  const select = vi.fn();
  const view = renderMenu('default', ['default', 'plan'], select);
  fireEvent.click(view.getByRole('button'));
  assert.equal(view.queryByRole('menuitemradio', { name: /Bypass/ }), null);
  fireEvent.click(view.getByRole('menuitemradio', { name: /^Plan/ }));
  assert.deepEqual(select.mock.calls, [['plan']]);
  assert.equal(view.queryByRole('menu'), null);
});

test('Escape closes the mode selector and keeps the current mode', () => {
  const select = vi.fn();
  const view = renderMenu('plan', ['plan'], select);
  fireEvent.click(view.getByRole('button'));
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(view.queryByRole('menu'), null);
  assert.equal(select.mock.calls.length, 0);
});

test('a provider with no modes shows no control', () => {
  const view = renderMenu('default', []);
  assert.equal(view.queryByRole('button'), null);
});

test('the mode names follow the interface language', async () => {
  await act(async () => {
    await i18n.changeLanguage('zh-CN');
  });
  try {
    const view = renderMenu('plan');
    assert.equal(view.getByRole('button').textContent, '计划');
  } finally {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  }
});
