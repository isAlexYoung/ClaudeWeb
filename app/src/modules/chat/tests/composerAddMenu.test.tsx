import assert from 'node:assert/strict';
import { fireEvent, render } from '@testing-library/react';
import { test, vi } from 'vitest';

import ComposerAddMenu from '@/modules/chat/composer/ComposerAddMenu';
import type { ComposerTaskMenu } from '@/shared/types';
import '@/modules/i18n';

test('the plus menu contains attachments, commands/skills and scheduling, and delegates command selection', () => {
  const select = vi.fn();
  const view = render(<ComposerAddMenu commands={[{ name: '/help', description: 'Help' }]} onSelectCommand={select} onAttach={() => {}} onSchedule={() => {}} canSchedule={false} />);
  fireEvent.click(view.getByRole('button'));
  const buttons = view.getAllByRole('menuitem');
  assert.equal(buttons.length, 3);
  assert.ok((buttons[1] as HTMLButtonElement).disabled);
  fireEvent.click(view.getByRole('menuitem', { name: /help/ }));
  assert.equal(select.mock.calls[0][0].name, '/help');
  assert.equal(view.queryByRole('menu'), null);
});

test('scheduling stays inside the plus menu and preserves the chosen time', () => {
  const schedule = vi.fn();
  const view = render(<ComposerAddMenu commands={[]} onSelectCommand={() => {}} onAttach={() => {}} onSchedule={schedule} canSchedule />);
  fireEvent.click(view.getByRole('button'));
  fireEvent.click(view.getAllByRole('menuitem')[1]);
  fireEvent.click(view.getAllByRole('menuitemradio')[0]);
  assert.ok(schedule.mock.calls[0][0] instanceof Date);
  assert.equal(view.queryByRole('menu'), null);
});

function taskMenu(overrides: Partial<ComposerTaskMenu> = {}): ComposerTaskMenu {
  return {
    isReady: true,
    nextTask: { id: '3', title: 'Write the parser' },
    prdFiles: ['prd.md'],
    onInitialize: vi.fn(),
    onShowBoard: vi.fn(),
    onStartNextTask: vi.fn(),
    onLoadPrdFiles: vi.fn(),
    onGenerateFromPrd: vi.fn(),
    ...overrides,
  };
}

function openMenu(tasks: ComposerTaskMenu) {
  const view = render(<ComposerAddMenu commands={[]} onSelectCommand={() => {}} onAttach={() => {}} onSchedule={() => {}} canSchedule tasks={tasks} />);
  fireEvent.click(view.getByRole('button'));
  return view;
}

test('an uninitialised project only offers TaskMaster initialisation', () => {
  const tasks = taskMenu({ isReady: false });
  const view = openMenu(tasks);
  assert.equal(view.queryByRole('menuitem', { name: /Open task board/ }), null);
  fireEvent.click(view.getByRole('menuitem', { name: /Initialize TaskMaster/ }));
  assert.equal((tasks.onInitialize as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  assert.equal(view.queryByRole('menu'), null);
});

test('the tasks section opens the board, starts the next task and lists PRDs to parse', () => {
  const tasks = taskMenu();
  const view = openMenu(tasks);
  assert.ok(view.getByRole('menuitem', { name: /#3 Write the parser/ }));
  fireEvent.click(view.getByRole('menuitem', { name: /Work on the next task/ }));
  assert.equal((tasks.onStartNextTask as ReturnType<typeof vi.fn>).mock.calls.length, 1);

  fireEvent.click(view.getByRole('button', { name: 'Add' }));
  fireEvent.click(view.getByRole('menuitem', { name: /Generate tasks from a PRD/ }));
  assert.equal((tasks.onLoadPrdFiles as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  fireEvent.click(view.getByRole('menuitem', { name: 'prd.md' }));
  assert.deepEqual((tasks.onGenerateFromPrd as ReturnType<typeof vi.fn>).mock.calls[0], ['prd.md']);
  assert.equal(view.queryByRole('menu'), null);
});

test('without a pending task the next-task item is disabled, and an empty PRD list says so', () => {
  const view = openMenu(taskMenu({ nextTask: null, prdFiles: [] }));
  assert.ok((view.getByRole('menuitem', { name: /No pending tasks/ }) as HTMLButtonElement).disabled);
  fireEvent.click(view.getByRole('menuitem', { name: /Generate tasks from a PRD/ }));
  assert.ok(view.getByText(/No PRDs yet/));
});
