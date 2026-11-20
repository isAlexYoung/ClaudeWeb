import assert from 'node:assert/strict';

import { test } from 'vitest';

import { getAllSessions } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import type { Project } from '@/shared/types';

const PROJECT_A = {
  projectId: 'a',
  name: 'a',
  displayName: 'a',
  fullPath: '/tmp/a',
  sessions: ['a1', 'a2'].map((id) => ({ id, summary: id, lastActivity: '2026-08-21T10:00:00.000Z' })),
} as unknown as Project;

test('the sorted session list is the same array until the project itself changes', () => {
  // A fresh array here is on its own enough to defeat every row memo below it.
  assert.equal(getAllSessions(PROJECT_A), getAllSessions(PROJECT_A));

  const replaced = { ...PROJECT_A };
  assert.notEqual(
    getAllSessions(replaced),
    getAllSessions(PROJECT_A),
    'a replaced project must not read a stale entry',
  );
});
