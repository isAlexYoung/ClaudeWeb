import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import WorkspaceTaskList from '@/modules/project-workspace/WorkspaceTaskList';
import { publishSessionTasks } from '@/shared/sessionTasks';

const STARTED = Date.parse('2026-11-24T10:00:00.000Z');

afterEach(() => {
  act(() => publishSessionTasks('session-1', []));
  vi.useRealTimers();
});

describe('the running tasks under Memory', () => {
  it('shows nothing while the session runs no task', () => {
    const { container } = render(<WorkspaceTaskList sessionId="session-1" />);
    expect(container.innerHTML).toBe('');
  });

  it('lists each task with its kind, its name and a running clock, and stops it from its button', () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED + 65_000);
    const stop = vi.fn();
    act(() => publishSessionTasks('session-1', [
      { id: 'toolu_1', taskId: 'task-1', kind: 'Command', name: 'gh run watch 123', startedAt: STARTED },
    ], stop));

    render(<WorkspaceTaskList sessionId="session-1" />);
    expect(screen.getByText('gh run watch 123')).toBeTruthy();
    expect(screen.getByText('Command')).toBeTruthy();
    expect(screen.getByText('1m 05s')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByText('1m 07s')).toBeTruthy();

    fireEvent.click(screen.getByRole('button'));
    expect(stop).toHaveBeenCalledWith('task-1');
  });

  it('shows only the tasks of the session being viewed', () => {
    act(() => publishSessionTasks('session-2', [
      { id: 'toolu_2', taskId: 'task-2', kind: 'Agent', name: 'Survey', startedAt: STARTED },
    ]));
    const { container } = render(<WorkspaceTaskList sessionId="session-1" />);
    expect(container.innerHTML).toBe('');
    act(() => publishSessionTasks('session-2', []));
  });

  it('disappears once the last task has finished', () => {
    act(() => publishSessionTasks('session-1', [
      { id: 'toolu_1', taskId: 'task-1', kind: 'Agent', name: 'Survey the repo', startedAt: STARTED },
    ]));
    const { container } = render(<WorkspaceTaskList sessionId="session-1" />);
    expect(screen.getByText('Survey the repo')).toBeTruthy();
    act(() => publishSessionTasks('session-1', []));
    expect(container.innerHTML).toBe('');
  });
});
