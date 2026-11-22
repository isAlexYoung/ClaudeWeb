import { useEffect } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { WorkspaceToolsProvider, useWorkspaceTools } from '@/modules/project-workspace/context/WorkspaceToolsContext';

const remote = vi.hoisted(() => ({ starts: 0, stops: 0 }));
vi.mock('@/modules/standalone-shell', () => ({ StandaloneShell: () => null }));
vi.mock('@/modules/graphical-panel', () => ({ GraphicalPanel: ({ visible }: { visible: boolean }) => {
  useEffect(() => { remote.starts++; return () => { remote.stops++; }; }, []);
  return <div data-testid="remote-desktop" data-visible={visible} />;
} }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<object>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Probe() {
  const tools = useWorkspaceTools();
  return <>
    <button onClick={tools.openDesktop}>open</button>
    {tools.minimized.desktop && <span data-testid="minimized" />}
  </>;
}

test('minimize hides without unmounting, restore retains the session, and Close alone ends it', () => {
  const view = render(<WorkspaceToolsProvider><Probe /></WorkspaceToolsProvider>);
  fireEvent.click(view.getByText('open'));
  expect(view.getByRole('dialog', { name: 'ClaudeDesktop' })).toBeTruthy();
  expect(remote.starts).toBe(1);
  fireEvent.click(view.getByRole('button', { name: 'workspace.desktop.minimize' }));
  expect(view.queryByRole('dialog')).toBeNull();
  expect(view.getByTestId('remote-desktop').dataset.visible).toBe('false');
  expect(view.getByTestId('minimized')).toBeTruthy();
  expect(remote.stops).toBe(0);
  fireEvent.click(view.getByText('open'));
  expect(view.queryByTestId('minimized')).toBeNull();
  expect(remote.starts).toBe(1);
  fireEvent.click(view.getByRole('button', { name: 'workspace.desktop.maximize' }));
  expect(view.getByRole('dialog').className).toContain('is-maximized');
  act(() => fireEvent.click(view.getByRole('button', { name: 'workspace.desktop.close' })));
  expect(remote.stops).toBe(1);
  expect(view.queryByTestId('remote-desktop')).toBeNull();
  view.unmount();
});
