import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { test, vi } from 'vitest';

import { WorkspaceToolSlot, WorkspaceToolsProvider, useWorkspaceTools } from '@/modules/project-workspace/context/WorkspaceToolsContext';
import type { Project } from '@/shared/types';

// A stand-in terminal that records how often it starts and stops, and what it was told.
const terminal = vi.hoisted(() => ({ mounts: 0, unmounts: 0, props: [] as Array<Record<string, unknown>> }));
vi.mock('@/modules/standalone-shell', () => ({
  StandaloneShell: (props: Record<string, unknown>) => {
    terminal.props.push(props);
    useEffect(() => {
      terminal.mounts += 1;
      return () => { terminal.unmounts += 1; };
    }, []);
    return <div data-testid="terminal">{String((props.project as Project).displayName)}</div>;
  },
}));

// A stand-in browser panel: the real one connects to the desktop's Chromium.
const browser = vi.hoisted(() => ({ mounts: 0, unmounts: 0, visible: [] as boolean[] }));
vi.mock('@/modules/browser-panel', () => ({
  BrowserPanel: ({ visible }: { visible: boolean }) => {
    browser.visible.push(visible);
    useEffect(() => {
      browser.mounts += 1;
      return () => { browser.unmounts += 1; };
    }, []);
    return <div data-testid="browser"><input aria-label="Browser content" defaultValue="" /></div>;
  },
}));

const WEBSITE = { projectId: 'p1', displayName: 'Website', fullPath: '/srv/website' } as unknown as Project;
const BLOG = { projectId: 'p2', displayName: 'Blog', fullPath: '/srv/blog' } as unknown as Project;

let tools: ReturnType<typeof useWorkspaceTools>;
const capture = (value: ReturnType<typeof useWorkspaceTools>) => { tools = value; };
function Probe({ showSlot, tool = 'terminal' }: { showSlot: boolean; tool?: 'terminal' | 'browser' }) {
  const value = useWorkspaceTools();
  useEffect(() => capture(value));
  return showSlot ? <section data-testid="dock"><WorkspaceToolSlot tool={tool} /></section> : null;
}

test('the browser keeps running after Back and ends only when closed', () => {
  const view = render(<WorkspaceToolsProvider><Probe showSlot tool="browser" /></WorkspaceToolsProvider>);
  assert.equal(view.queryByTestId('browser'), null, 'nothing runs until the user opens it');
  act(() => tools.openBrowser());
  assert.equal(browser.mounts, 1);
  assert.ok(view.getByTestId('dock').contains(view.getByTestId('browser')));
  assert.equal(browser.visible.at(-1), true);

  view.rerender(<WorkspaceToolsProvider><Probe showSlot={false} tool="browser" /></WorkspaceToolsProvider>);
  assert.equal(browser.unmounts, 0);
  assert.equal(browser.visible.at(-1), false);

  // The globe icon again: the same browser, shown where it was.
  view.rerender(<WorkspaceToolsProvider><Probe showSlot tool="browser" /></WorkspaceToolsProvider>);
  act(() => tools.openBrowser());
  assert.equal(browser.mounts, 1);
  assert.ok(view.getByTestId('dock').contains(view.getByTestId('browser')));

  act(() => tools.closeBrowser());
  assert.equal(browser.unmounts, 1);
  assert.equal(view.queryByTestId('browser'), null);
});

test('the terminal keeps running while hidden and ends only when closed', () => {
  const view = render(<WorkspaceToolsProvider><Probe showSlot /></WorkspaceToolsProvider>);
  act(() => tools.openTerminal(WEBSITE, null));
  assert.equal(terminal.mounts, 1);
  assert.ok(view.getByTestId('dock').contains(view.getByTestId('terminal')), 'shown in the inspector');
  assert.equal(terminal.props.at(-1)?.endSessionOnUnmount, true);
  assert.equal(terminal.props.at(-1)?.isActive, true);

  // Back / collapsing the inspector: the slot goes away, the terminal does not.
  view.rerender(<WorkspaceToolsProvider><Probe showSlot={false} /></WorkspaceToolsProvider>);
  assert.equal(terminal.unmounts, 0);
  assert.equal(terminal.props.at(-1)?.isActive, false);

  // Opening it again from another project continues the same terminal.
  view.rerender(<WorkspaceToolsProvider><Probe showSlot /></WorkspaceToolsProvider>);
  act(() => tools.openTerminal(BLOG, null));
  assert.equal(terminal.mounts, 1);
  assert.equal(view.getByTestId('terminal').textContent, 'Website');
  assert.ok(view.getByTestId('dock').contains(view.getByTestId('terminal')));

  act(() => tools.closeTerminal());
  assert.equal(terminal.unmounts, 1);
  assert.equal(view.queryByTestId('terminal'), null);
});

test('the same browser content survives switching between chat and plugin page docks', () => {
  const initialMounts = browser.mounts;
  const view = render(<WorkspaceToolsProvider><div key="chat"><Probe showSlot tool="browser" /></div></WorkspaceToolsProvider>);
  act(() => tools.openBrowser());
  const original = view.getByTestId('browser');
  fireEvent.change(view.getByRole('textbox', { name: 'Browser content' }), { target: { value: 'An already-open authorization page' } });
  view.rerender(<WorkspaceToolsProvider><div key="plugins"><Probe showSlot={false} tool="browser" /></div></WorkspaceToolsProvider>);
  assert.equal(tools.minimized.browser, true);
  view.rerender(<WorkspaceToolsProvider><div key="plugins"><Probe showSlot tool="browser" /></div></WorkspaceToolsProvider>);
  act(() => tools.openBrowser());
  assert.equal(view.getByTestId('browser'), original);
  assert.equal((view.getByRole('textbox', { name: 'Browser content' }) as HTMLInputElement).value, 'An already-open authorization page');
  assert.equal(browser.mounts, initialMounts + 1);
  assert.equal(tools.minimized.browser, false);
  view.rerender(<WorkspaceToolsProvider><div key="chat"><Probe showSlot tool="browser" /></div></WorkspaceToolsProvider>);
  assert.equal(view.getByTestId('browser'), original);
  act(() => tools.closeBrowser());
  assert.equal(tools.minimized.browser, false);
});
