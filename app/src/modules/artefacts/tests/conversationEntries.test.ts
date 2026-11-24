import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';
import { toConversationEntries } from '@/modules/artefacts/sheet/conversationEntries';

const message = (fields: Partial<NormalizedMessage> & { id: string; kind: NormalizedMessage['kind'] }) => fields as NormalizedMessage;

test('the drawer shows the messages and folds each run of tool calls into one line', () => {
  const entries = toConversationEntries([
    message({ id: 'm1', kind: 'text', role: 'user', content: '  Make a monthly budget  ' }),
    message({ id: 't1', kind: 'tool_use' }),
    message({ id: 'r1', kind: 'tool_result' }),
    message({ id: 't2', kind: 'tool_use' }),
    message({ id: 'm2', kind: 'text', role: 'assistant', content: 'Done.' }),
    message({ id: 't3', kind: 'tool_use' }),
    message({ id: 'm3', kind: 'text', role: 'assistant', content: '   ' }),
    message({ id: 'm4', kind: 'text', role: 'user', content: 'Summary of earlier turns', isCompactSummary: true }),
    message({ id: 'th', kind: 'thinking', content: 'hmm' }),
  ]);
  assert.deepEqual(entries, [
    { kind: 'message', id: 'm1', role: 'user', text: 'Make a monthly budget' },
    { kind: 'tools', id: 'tools-t1', count: 2 },
    { kind: 'message', id: 'm2', role: 'assistant', text: 'Done.' },
    { kind: 'tools', id: 'tools-t3', count: 1 },
  ]);
});
