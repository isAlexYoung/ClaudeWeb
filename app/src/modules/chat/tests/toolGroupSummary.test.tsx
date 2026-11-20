import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeAll, test } from 'vitest';

import { i18n } from '@/modules/i18n';
import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import type { ChatMessage } from '@/shared/types';

/**
 * A run of tool calls reads as Claude Desktop shows it: one line naming who
 * was called how often and how many calls failed, opening to a line per call.
 */

const createDiff = createCachedDiffCalculator();

const call = (toolName: string, toolInput: Record<string, unknown>, isError = false): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: '2026-11-14T00:00:00.000Z',
  isToolUse: true,
  toolName,
  toolInput: JSON.stringify(toolInput),
  toolId: `${toolName}-${JSON.stringify(toolInput)}`,
  ...(isError ? { toolResult: { content: 'failed', isError: true } } : {}),
});

const renderRun = (messages: ChatMessage[]) => {
  const [group] = groupConsecutiveTools(messages);
  assert.ok(isToolGroupItem(group));
  return render(
    <ToolGroupContainer
      group={group}
      prevMessage={null}
      createDiff={createDiff}
      getMessageKey={(message) => String(message.toolId)}
      provider="claude"
    />,
  );
};

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

test('a run of calls to one server is one line with its count and failures, opening to a line per call', () => {
  const { container } = renderRun([
    call('mcp__windows-pc-files__edit_file', { path: 'F:/a.cjs' }),
    call('mcp__windows-pc-files__windows_execute', { command: 'dir' }, true),
    call('mcp__windows-pc-files__read_text_file', { path: 'F:/b.ts' }),
  ]);

  const summary = screen.getByRole('button', { name: /Used windows-pc-files 3 times \(1 failed\)/ });
  assert.equal(summary.getAttribute('aria-expanded'), 'false');
  assert.doesNotMatch(container.textContent ?? '', /Edit File/, 'calls stay hidden until the line is opened');

  fireEvent.click(summary);

  assert.ok(screen.getByRole('button', { name: /windows-pc-files: Edit File/ }));
  assert.ok(screen.getByRole('button', { name: /windows-pc-files: Windows Execute.*Failed/ }));
  assert.ok(screen.getByRole('button', { name: /windows-pc-files: Read Text File/ }));
});

test('a run that mixes tools counts calls without naming a source', () => {
  renderRun([
    call('Read', { file_path: '/repo/a.ts' }),
    call('Grep', { pattern: 'todo' }),
  ]);

  assert.ok(screen.getByRole('button', { name: /Used tools 2 times/ }));
});

test('a single call is just its own line', () => {
  renderRun([call('mcp__windows-pc-files__edit_file', { path: 'F:/a.cjs' })]);

  assert.ok(screen.getByRole('button', { name: /windows-pc-files: Edit File/ }));
  assert.equal(screen.queryByRole('button', { name: /Used/ }), null);
});
