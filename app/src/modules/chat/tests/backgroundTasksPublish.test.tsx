import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import { BackgroundTasksStrip } from '@/modules/chat/transcript/BackgroundTasksStrip';
import { useSessionTasks } from '@/shared/sessionTasks';
import type { ChatMessage } from '@/shared/types';

/**
 * The strip is the only place that knows every running task while a turn is
 * still going, so it publishes its list for the workspace inspector, which
 * lists the tasks under Memory with their elapsed time and a stop button.
 */

const STARTED = '2026-11-24T10:00:00.000Z';

const runningAgent: ChatMessage = {
  type: 'assistant',
  content: '',
  timestamp: STARTED,
  isToolUse: true,
  toolName: 'Agent',
  toolId: 'toolu_agent_1',
  isSubagentContainer: true,
  taskStatus: { status: 'running', taskId: 'task-agent', description: 'Survey the repo' },
};

describe('the task strip publishing for the inspector', () => {
  it('publishes each running task with what stops it, and withdraws it once it finishes', () => {
    const sendMessage = vi.fn();
    const reader = renderHook(() => useSessionTasks('session-1'));
    const strip = render(
      <BackgroundTasksStrip sessionId="session-1" sendMessage={sendMessage} onReveal={() => {}} onLoadAll={() => {}} messages={[runningAgent]} />,
    );

    expect(reader.result.current.entries).toEqual([
      { id: 'toolu_agent_1', taskId: 'task-agent', kind: 'Agent', name: 'Survey the repo', startedAt: Date.parse(STARTED) },
    ]);
    act(() => reader.result.current.stop?.('task-agent'));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'chat.stop-task', sessionId: 'session-1', taskId: 'task-agent' });

    strip.rerender(
      <BackgroundTasksStrip
        sessionId="session-1"
        sendMessage={sendMessage}
        onReveal={() => {}}
        onLoadAll={() => {}}
        messages={[{ ...runningAgent, taskStatus: { status: 'completed', taskId: 'task-agent' } }]}
      />,
    );
    expect(reader.result.current.entries).toEqual([]);
  });

  it('withdraws the list when the chat stops showing the session', () => {
    const reader = renderHook(() => useSessionTasks('session-1'));
    const strip = render(
      <BackgroundTasksStrip sessionId="session-1" sendMessage={() => {}} onReveal={() => {}} onLoadAll={() => {}} messages={[runningAgent]} />,
    );
    expect(reader.result.current.entries).toHaveLength(1);
    strip.unmount();
    expect(reader.result.current.entries).toEqual([]);
  });
});
