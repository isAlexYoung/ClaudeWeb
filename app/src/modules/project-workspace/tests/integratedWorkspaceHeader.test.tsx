import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeAll, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { WorkspaceExperienceProvider, useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import type { Project, ProjectSession, TranscriptActions, WorkspaceMode } from '@/shared/types';
import IntegratedWorkspaceHeader from '@/modules/project-workspace/IntegratedWorkspaceHeader';

/** Stands in for the open transcript, which registers its copy/export actions. */
function RegisterTranscript({ actions }: { actions: TranscriptActions }) {
  const { setTranscriptActions } = useWorkspaceExperience();
  useEffect(() => {
    setTranscriptActions(actions);
    return () => setTranscriptActions(null);
  }, [actions, setTranscriptActions]);
  return null;
}

const renderHeader = (actions?: TranscriptActions) => render(
  <WorkspaceExperienceProvider>
    {actions && <RegisterTranscript actions={actions} />}
    <IntegratedWorkspaceHeader
      project={null}
      session={null}
      mobile={false}
      inspectorOpen
      onMenu={() => {}}
      onInspectorToggle={() => {}}
      onTool={() => {}}
      onTasks={() => {}}
    />
  </WorkspaceExperienceProvider>,
);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

test('the More menu offers copy and export only while a conversation is open', () => {
  const empty = renderHeader();
  fireEvent.click(empty.getByRole('button', { name: 'More actions' }));
  assert.ok(empty.getByRole('menuitem', { name: 'Tasks' }));
  assert.equal(empty.queryByRole('menuitem', { name: 'Copy conversation' }), null);
  empty.unmount();

  const withTranscript = renderHeader({ copy: vi.fn(async () => {}), download: vi.fn(async () => {}) });
  fireEvent.click(withTranscript.getByRole('button', { name: 'More actions' }));
  for (const name of ['Copy conversation', 'Export as web page', 'Export as Markdown', 'Export as JSON']) {
    assert.ok(withTranscript.getByRole('menuitem', { name }), `${name} is offered`);
  }
});

test('copy and export run the transcript actions and say what happened', async () => {
  const actions = { copy: vi.fn(async () => {}), download: vi.fn(async () => {}) };
  const view = renderHeader(actions);

  fireEvent.click(view.getByRole('button', { name: 'More actions' }));
  await act(async () => {
    fireEvent.click(view.getByRole('menuitem', { name: 'Copy conversation' }));
  });
  assert.equal(actions.copy.mock.calls.length, 1);
  assert.equal(view.getByRole('status').textContent, 'Conversation copied');

  fireEvent.click(view.getByRole('button', { name: 'More actions' }));
  await act(async () => {
    fireEvent.click(view.getByRole('menuitem', { name: 'Export as Markdown' }));
  });
  assert.deepEqual(actions.download.mock.calls, [['markdown']]);
});

test('a failed copy is reported instead of claiming success', async () => {
  const actions = { copy: vi.fn(async () => { throw new Error('clipboard denied'); }), download: vi.fn(async () => {}) };
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const view = renderHeader(actions);

  fireEvent.click(view.getByRole('button', { name: 'More actions' }));
  await act(async () => {
    fireEvent.click(view.getByRole('menuitem', { name: 'Copy conversation' }));
  });
  assert.equal(view.getByRole('status').textContent, 'That did not work. Try again.');
  errorLog.mockRestore();
});

/** Opens a conversation the way the sidebar does, in the given mode. */
function EnterSession({ id, mode }: { id: string; mode: WorkspaceMode }) {
  const { enterSession } = useWorkspaceExperience();
  useEffect(() => { enterSession(id, mode); }, [enterSession, id, mode]);
  return null;
}

const SESSION = { id: 's1', summary: 'Fix the build', __provider: 'claude' } as ProjectSession;
const PROJECT = { projectId: 'p1', displayName: 'Website', fullPath: '/srv/website', path: '/srv/website' } as unknown as Project;

const renderSession = (mode: WorkspaceMode, onRenameSession = vi.fn(async () => true)) => ({
  onRenameSession,
  view: render(
    <WorkspaceExperienceProvider>
      <EnterSession id="s1" mode={mode} />
      <IntegratedWorkspaceHeader
        project={PROJECT}
        session={SESSION}
        mobile={false}
        inspectorOpen
        onMenu={() => {}}
        onInspectorToggle={() => {}}
        onTool={() => {}}
        onTasks={() => {}}
        onRenameSession={onRenameSession}
      />
    </WorkspaceExperienceProvider>,
  ),
});

test('the Chat home is titled Chat in every language, like the Code home', async () => {
  for (const language of ['en', 'zh-CN']) {
    await i18n.changeLanguage(language);
    const view = renderHeader();
    assert.equal(view.container.querySelector('.workspace-header-title')?.textContent, 'Chat');
    view.unmount();
  }
  await i18n.changeLanguage('en');
});

test('a Code conversation shows its title and project, and the title renames in place', async () => {
  const { view, onRenameSession } = renderSession('project');
  assert.ok(view.getByText('· Website'));
  fireEvent.click(view.getByRole('button', { name: 'Fix the build' }));
  const field = view.getByRole('textbox', { name: 'Conversation title' }) as HTMLInputElement;
  assert.equal(field.value, 'Fix the build');
  fireEvent.change(field, { target: { value: 'Fix the CI build' } });
  await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }); });
  assert.deepEqual(onRenameSession.mock.calls, [['Fix the CI build']]);
  assert.equal(view.queryByRole('textbox'), null);

  // Escape leaves the title as it was.
  fireEvent.click(view.getByRole('button', { name: 'Fix the build' }));
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Something else' } });
  fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' });
  assert.equal(onRenameSession.mock.calls.length, 1);
});

test('a Chat conversation shows no project name', () => {
  const { view } = renderSession('chat');
  assert.ok(view.getByRole('button', { name: 'Fix the build' }));
  assert.equal(view.queryByText('· Website'), null);
});
