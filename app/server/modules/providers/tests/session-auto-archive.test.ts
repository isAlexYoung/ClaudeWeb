import assert from 'node:assert/strict';
import test from 'node:test';

import {
  archiveInactiveSessions,
  readAutoArchiveDays,
  readPinnedSessionIds,
} from '@/modules/providers/services/session-auto-archive.service.js';

/** The hourly archiver: off unless chosen, and never touches running or pinned sessions. */

test('the archive period is off by default and takes the most cautious stored choice', () => {
  assert.equal(readAutoArchiveDays([]), null);
  assert.equal(readAutoArchiveDays([0]), null);
  assert.equal(readAutoArchiveDays([7]), 7);
  assert.equal(readAutoArchiveDays([3, 30]), 30);
  assert.equal(readAutoArchiveDays([7, 0]), null);
  // Values the settings page never offers are ignored rather than trusted.
  assert.equal(readAutoArchiveDays([2, '7', -1]), null);
});

test('pinned ids are read from every user\'s workspaceSessions', () => {
  const pinned = readPinnedSessionIds([{ pinnedSessionIds: ['a', 'b', 3] }, null, { pinnedSessionIds: ['c'] }, 'junk']);
  assert.deepEqual([...pinned].sort(), ['a', 'b', 'c']);
});

test('a pass archives inactive sessions except running and pinned ones', async () => {
  const archived: string[] = [];
  const asked: number[] = [];
  const result = await archiveInactiveSessions({
    readPreference: (key) => (key === 'autoArchiveInactiveDays' ? [7] : [{ pinnedSessionIds: ['pinned'] }]),
    listInactive: (days) => {
      asked.push(days);
      return [{ session_id: 'old' }, { session_id: 'pinned' }, { session_id: 'running' }, { session_id: 'older' }];
    },
    listRunningIds: async () => ['running'],
    archive: (id) => archived.push(id),
  });
  assert.deepEqual(asked, [7]);
  assert.deepEqual(result, ['old', 'older']);
  assert.deepEqual(archived, ['old', 'older']);
});

test('nothing is read or archived while the setting is Never', async () => {
  let listed = false;
  const result = await archiveInactiveSessions({
    readPreference: () => [],
    listInactive: () => { listed = true; return [{ session_id: 'old' }]; },
    listRunningIds: async () => [],
    archive: () => assert.fail('must not archive'),
  });
  assert.deepEqual(result, []);
  assert.equal(listed, false);
});
