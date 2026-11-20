import assert from 'node:assert/strict';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { ContextUsageDetails } from '@/shared/types';
import WorkspaceContextInspector from '@/modules/project-workspace/WorkspaceContextInspector';
import { WorkspaceToolsProvider } from '@/modules/project-workspace/context/WorkspaceToolsContext';
import '@/modules/i18n';

const harness = vi.hoisted(() => ({ details: null as ContextUsageDetails | null, usage: { used: 100, total: 1000 } }));
vi.mock('@/shared/context/WorkspaceExperienceContext', () => ({ useWorkspaceExperience: () => ({ contextDetails: harness.details, contextUsage: harness.usage, mode: 'project' }) }));
vi.mock('@/shared/context/UiPreferencesContext', () => ({ useUiPreferences: () => ({ chatMcpEnabled: false }) }));
vi.mock('@/modules/file-tree', () => ({ FileTree: () => null }));
vi.mock('@/modules/standalone-shell', () => ({ StandaloneShell: () => null }));

test('collapsed Context shows a capsule and expanded Context uses SDK categories, not billing estimates', () => {
  harness.details = { totalTokens: 320000, maxTokens: 1000000, percentage: 32,
    categories: [{ name: 'Messages', tokens: 269200, color: 'blue' }, { name: 'MCP tools', tokens: 14200, color: 'cyan' }] };
  const view = render(<WorkspaceContextInspector view="context" project={null} session={null} onBack={() => {}} onFileOpen={() => {}} />, { wrapper: WorkspaceToolsProvider });
  assert.equal((view.container.querySelector('.workspace-context-capsule b') as HTMLElement).style.width, '32%');
  fireEvent.click(view.container.querySelector('button')!);
  assert.ok(view.getByText('Messages'));
  assert.ok(view.getByText('269.2k'));
  assert.ok(view.getByText('26.9%'));
});

test('missing SDK categories retains known totals and never makes up category rows', () => {
  harness.details = null;
  const view = render(<WorkspaceContextInspector view="context" project={null} session={null} onBack={() => {}} onFileOpen={() => {}} />, { wrapper: WorkspaceToolsProvider });
  fireEvent.click(view.container.querySelector('button')!);
  assert.equal(view.container.querySelectorAll('.workspace-context-category').length, 0);
  assert.ok(view.container.querySelector('.workspace-context-unavailable'));
});

test('connectors collapse and reopen independently of the context disclosure', async () => {
  const view = render(<WorkspaceContextInspector view="context" project={null} session={null} onBack={() => {}} onFileOpen={() => {}} />, { wrapper: WorkspaceToolsProvider });
  const connectors = view.getByRole('button', { name: 'Connectors' });
  assert.equal(connectors.getAttribute('aria-expanded'), 'false');
  fireEvent.click(connectors);
  assert.equal(connectors.getAttribute('aria-expanded'), 'true');
  fireEvent.click(connectors);
  assert.equal(connectors.getAttribute('aria-expanded'), 'false');
  await waitFor(() => assert.equal(Boolean(view.container.querySelector('.workspace-connectors-disclosure')), false));
  fireEvent.click(connectors);
  assert.equal(connectors.getAttribute('aria-expanded'), 'true');
  assert.ok(view.container.querySelector('.workspace-connectors-disclosure'));
  assert.equal(view.getByRole('button', { name: /Context/ }).getAttribute('aria-expanded'), 'false');
});

test('unknown usage keeps the capsule without a dash or a fabricated percentage', () => {
  harness.details = null;
  harness.usage = { used: 0, total: 0 };
  const view = render(<WorkspaceContextInspector view="context" project={null} session={null} onBack={() => {}} onFileOpen={() => {}} />, { wrapper: WorkspaceToolsProvider });
  assert.equal(view.container.querySelector('.workspace-context-capsule')?.textContent, '');
  assert.equal((view.container.querySelector('.workspace-context-capsule b') as HTMLElement).style.width, '0%');
});
