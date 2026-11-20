import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import ChangeDiffPanel from '@/modules/chat/transcript/ChangeDiffPanel';
import ChangeSummaryCard from '@/modules/chat/transcript/ChangeSummaryCard';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import { collectTurnChanges, layoutFileHunks, splitChangePath } from '@/modules/chat/utils/turnChanges';
import type { ChatMessage, TurnChanges } from '@/shared/types';

/** The change summary card and the Changes panel: what each turn changed, file by file. */

beforeAll(async () => { await i18n.changeLanguage('en'); });

const createDiff = createCachedDiffCalculator();
const user = (text: string): ChatMessage => ({ type: 'user', content: text, timestamp: 1, transcriptAnchorId: `anchor-${text}` });
const reply = (text: string): ChatMessage => ({ type: 'assistant', content: text, timestamp: 2 });
const edit = (input: Record<string, unknown>, toolUseResult?: unknown, toolName = 'Edit', isError = false): ChatMessage => ({
  type: 'assistant',
  isToolUse: true,
  toolName,
  toolInput: JSON.stringify(input),
  toolResult: { content: isError ? 'denied' : 'ok', isError, toolUseResult },
  timestamp: 2,
});

// Claude Code's record of an edit: line 12 replaced, with a line of context on each side.
const PATCH = { structuredPatch: [{ oldStart: 11, oldLines: 3, newStart: 11, newLines: 4, lines: [' a', '-old', '+new', '+more', ' b'] }] };

describe('collecting what each turn changed', () => {
  it('uses the recorded patch, falls back to the edit itself, and skips failed edits', () => {
    const lastReply = reply('done');
    const messages = [
      user('one'),
      edit({ file_path: '/srv/app/src/a.ts', old_string: 'old', new_string: 'new\nmore' }, PATCH),
      edit({ file_path: '/srv/app/src/b.ts', old_string: 'x\ny', new_string: 'x\nz' }),
      edit({ file_path: '/srv/app/denied.ts', old_string: 'a', new_string: 'b' }, undefined, 'Edit', true),
      edit({ file_path: '/srv/app/new.md', content: 'hello\nworld\n' }, { type: 'create', structuredPatch: [] }, 'Write'),
      lastReply,
    ];
    const turns = collectTurnChanges(messages, createDiff, false);
    const changes = turns.get(lastReply);
    expect(changes).toBeDefined();
    expect(changes?.files.map((file) => [file.path, file.added, file.removed, file.created])).toEqual([
      ['/srv/app/src/a.ts', 2, 1, false],
      ['/srv/app/src/b.ts', 1, 1, false],
      ['/srv/app/new.md', 2, 0, true],
    ]);
    expect([changes?.added, changes?.removed]).toEqual([5, 2]);
    expect(changes?.files[0].hunks[0]).toMatchObject({ oldStart: 11, newStart: 11, edit: 0 });
  });

  it('gives each turn its own card, and none to a running last turn or a turn without edits', () => {
    const firstEnd = reply('first');
    const secondEnd = reply('second');
    const thirdEnd = reply('third');
    const messages = [
      user('one'), edit({ file_path: '/a', old_string: 'a', new_string: 'b' }), firstEnd,
      user('two'), secondEnd,
      user('three'), edit({ file_path: '/c', old_string: 'a', new_string: 'b' }), thirdEnd,
    ];
    const done = collectTurnChanges(messages, createDiff, false);
    expect([done.has(firstEnd), done.has(secondEnd), done.has(thirdEnd)]).toEqual([true, false, true]);
    expect(done.get(firstEnd)?.id).toBe('anchor-one');
    const running = collectTurnChanges(messages, createDiff, true);
    expect([running.has(firstEnd), running.has(thirdEnd)]).toEqual([true, false]);
  });

  it('adds up several edits to one file and keeps their stretches apart', () => {
    const end = reply('done');
    const turns = collectTurnChanges([
      user('one'),
      edit({ file_path: '/a', old_string: 'old', new_string: 'new' }, PATCH),
      edit({ file_path: '/a', old_string: 'x', new_string: 'y' }, { structuredPatch: [{ oldStart: 40, newStart: 41, lines: ['-x', '+y'] }] }),
      end,
    ], createDiff, false);
    const file = turns.get(end)?.files[0];
    expect([file?.added, file?.removed, file?.hunks.map((hunk) => hunk.edit)]).toEqual([3, 2, [0, 1]]);
  });
});

describe('laying out a file diff', () => {
  it('folds unchanged lines before and between hunks and numbers lines from the file', () => {
    const rows = layoutFileHunks([
      { oldStart: 11, newStart: 11, lines: [' a', '-old', '+new', ' b'], edit: 0 },
      { oldStart: 30, newStart: 30, lines: ['-x', '+y'], edit: 0 },
      { oldStart: 5, newStart: 5, lines: ['+z'], edit: 1 },
    ]);
    expect(rows[0]).toEqual({ kind: 'gap', count: 10 });
    expect(rows.slice(1, 5)).toEqual([
      { kind: 'line', sign: ' ', text: 'a', oldNumber: 11, newNumber: 11 },
      { kind: 'line', sign: '-', text: 'old', oldNumber: 12, newNumber: null },
      { kind: 'line', sign: '+', text: 'new', oldNumber: null, newNumber: 12 },
      { kind: 'line', sign: ' ', text: 'b', oldNumber: 13, newNumber: 13 },
    ]);
    expect(rows[5]).toEqual({ kind: 'gap', count: 16 });
    expect(rows[8]).toEqual({ kind: 'edit-break' });
    expect(rows[9]).toEqual({ kind: 'gap', count: 4 });
  });

  it('shows a project file relative to the project', () => {
    expect(splitChangePath('/srv/app/macos/ui/app.js', '/srv/app')).toEqual({ directory: 'macos/ui/', name: 'app.js' });
    expect(splitChangePath('/etc/hosts', '/srv/app')).toEqual({ directory: '/etc/', name: 'hosts' });
    expect(splitChangePath('README.md')).toEqual({ directory: '', name: 'README.md' });
  });
});

const TURN: TurnChanges = {
  id: 'turn-1',
  added: 9,
  removed: 2,
  files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((name, index) => ({
    path: `/srv/app/src/${name}`,
    added: index + 1,
    removed: index === 0 ? 2 : 0,
    created: false,
    hunks: [{ oldStart: 3, newStart: 3, lines: ['-old', '+new'], edit: 0 }],
  })),
};

describe('the change summary card', () => {
  it('lists three files, shows the rest on request, and opens a file in the Changes panel', () => {
    const onOpenFile = vi.fn();
    render(<ChangeSummaryCard changes={TURN} projectRoot="/srv/app" onOpenFile={onOpenFile} />);
    const card = screen.getByRole('region', { name: 'Edited 5 files' });
    expect(within(card).getAllByRole('listitem')).toHaveLength(3);
    expect(card.textContent).toContain('+9');
    fireEvent.click(within(card).getByRole('button', { name: /Show 2 more files/ }));
    expect(within(card).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(within(card).getByTitle('/srv/app/src/d.ts'));
    expect(onOpenFile).toHaveBeenCalledWith(TURN, '/srv/app/src/d.ts');
  });
});

describe('the Changes panel', () => {
  it('shows the chosen file with folded lines and switches files', () => {
    const onSelect = vi.fn();
    render(<ChangeDiffPanel changes={TURN} path="/srv/app/src/b.ts" projectRoot="/srv/app" onSelect={onSelect} />);
    expect(screen.getByLabelText('/srv/app/src/b.ts')).toBeTruthy();
    expect(screen.getByText('2 unmodified lines')).toBeTruthy();
    expect(screen.getByRole('button', { name: /b\.ts/ }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByTitle('/srv/app/src/e.ts'));
    expect(onSelect).toHaveBeenCalledWith('/srv/app/src/e.ts');
  });
});
