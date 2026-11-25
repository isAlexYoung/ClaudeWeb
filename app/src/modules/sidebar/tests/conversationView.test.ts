import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test } from 'vitest';

import type { RecentConversationListItem } from '@/shared/types';
import {
  DEFAULT_CONVERSATION_PREFS,
  addSection,
  groupRecents,
  isConversationUnread,
  markSessionViewed,
  moveToSection,
  normalizeConversationPrefs,
  parseTimestamp,
  recentsQuery,
  removeSection,
  renameSection,
  resetSessionViewsCache,
  useSessionViews,
} from '@/modules/sidebar/conversationView';

const row = (sessionId: string, fields: Partial<RecentConversationListItem> = {}): RecentConversationListItem => ({
  sessionId,
  sessionTitle: sessionId,
  projectId: 'chat',
  provider: 'claude',
  projectDisplayName: 'Chat',
  lastActivity: null,
  ...fields,
});

beforeEach(() => {
  localStorage.clear();
  resetSessionViewsCache();
});

test('stored preferences of any shape read back complete and valid', () => {
  assert.deepEqual(normalizeConversationPrefs(null), DEFAULT_CONVERSATION_PREFS);
  assert.deepEqual(normalizeConversationPrefs('nonsense'), DEFAULT_CONVERSATION_PREFS);
  const prefs = normalizeConversationPrefs({
    chat: { status: 'archived', sinceDays: 30, scheduled: 'nope', groupBy: 'unread', sort: 'name' },
    code: { sort: 'created', order: 'sideways' },
    sections: [{ id: 's1', name: 'Work' }, { id: '', name: 'No id' }, { id: 's2', name: '  ' }, 'junk'],
    sessionSections: { a: 's1', b: 'gone', c: 3 },
    collapsed: { chatRecent: true, codeRecent: 'yes', sections: { s1: true, gone: true } },
  });
  assert.deepEqual(prefs.chat, { status: 'archived', sinceDays: 30, scheduled: 'shown', groupBy: 'unread', sort: 'name' });
  assert.deepEqual(prefs.code, { sort: 'created', order: 'desc' });
  assert.deepEqual(prefs.sections, [{ id: 's1', name: 'Work' }]);
  assert.deepEqual(prefs.sessionSections, { a: 's1' }, 'filings into missing sections are dropped');
  assert.deepEqual(prefs.collapsed, { chatRecent: true, codeRecent: false, sections: { s1: true } });
});

test('each mode asks the server for its own conversations, filtered and ordered as chosen', () => {
  const prefs = normalizeConversationPrefs({ chat: { status: 'all', sinceDays: 3, sort: 'created' }, code: { sort: 'name', order: 'asc' } });
  assert.deepEqual(recentsQuery('chat', prefs), {
    scope: 'chat', chatPath: '/home/claudeweb', status: 'all', sinceDays: 3, sort: 'created',
  });
  assert.deepEqual(recentsQuery('project', prefs), { scope: 'project', chatPath: '/home/claudeweb', sort: 'name', order: 'asc' });
});

test('sections are added (optionally with a conversation), renamed, filled and removed', () => {
  let prefs = addSection(DEFAULT_CONVERSATION_PREFS, { id: 's1', name: 'aa' }, 'chat-1');
  assert.deepEqual(prefs.sections, [{ id: 's1', name: 'aa' }]);
  assert.deepEqual(prefs.sessionSections, { 'chat-1': 's1' });
  prefs = renameSection(prefs, 's1', 'Work');
  assert.equal(prefs.sections[0].name, 'Work');
  prefs = moveToSection(prefs, 'chat-2', 's1');
  prefs = moveToSection(prefs, 'chat-1', null);
  assert.deepEqual(prefs.sessionSections, { 'chat-2': 's1' });
  prefs = { ...prefs, collapsed: { ...prefs.collapsed, sections: { s1: true } } };
  prefs = removeSection(prefs, 's1');
  assert.deepEqual(prefs.sections, []);
  assert.deepEqual(prefs.sessionSections, {});
  assert.deepEqual(prefs.collapsed.sections, {});
  assert.deepEqual(DEFAULT_CONVERSATION_PREFS.sections, [], 'the defaults are never changed in place');
});

test('SQLite timestamps are read as UTC; ISO ones as written', () => {
  assert.equal(parseTimestamp('2026-11-25 06:00:00'), Date.parse('2026-11-25T06:00:00Z'));
  assert.equal(parseTimestamp('2026-11-25T06:00:00.000Z'), Date.parse('2026-11-25T06:00:00.000Z'));
  assert.equal(parseTimestamp('2026-11-25T14:00:00+08:00'), Date.parse('2026-11-25T06:00:00Z'));
  assert.equal(parseTimestamp(null), null);
  assert.equal(parseTimestamp('soon'), null);
});

test('Recents group by date, unread or status, keep the server order, and gather or drop scheduled runs', () => {
  const now = new Date(2026, 10, 25, 15, 0, 0);
  const at = (days: number) => new Date(now.getTime() - days * 24 * 3600_000).toISOString();
  const items = [
    row('today', { lastActivity: at(0.1) }),
    row('yesterday', { lastActivity: at(1) }),
    row('week', { lastActivity: at(5) }),
    row('task', { lastActivity: at(0.2) }),
    row('month', { lastActivity: at(20), isArchived: true }),
    row('older', { lastActivity: at(90) }),
    row('never', { lastActivity: null }),
  ];
  const base = { scheduledIds: new Set(['task']), isUnread: (item: RecentConversationListItem) => item.sessionId === 'week', now };
  const keys = (groups: ReturnType<typeof groupRecents>) => groups.map((group) => [group.key, group.items.map((item) => item.sessionId)]);

  assert.deepEqual(keys(groupRecents(items, { ...base, groupBy: 'date', scheduled: 'grouped' })), [
    ['today', ['today']],
    ['yesterday', ['yesterday']],
    ['week', ['week']],
    ['month', ['month']],
    ['older', ['older', 'never']],
    ['scheduled', ['task']],
  ]);
  assert.deepEqual(keys(groupRecents(items, { ...base, groupBy: 'none', scheduled: 'hidden' })), [
    ['all', ['today', 'yesterday', 'week', 'month', 'older', 'never']],
  ]);
  assert.deepEqual(keys(groupRecents(items, { ...base, groupBy: 'none', scheduled: 'shown' }))[0][1].includes('task'), true);
  assert.deepEqual(keys(groupRecents(items, { ...base, groupBy: 'unread', scheduled: 'hidden' })).map(([key]) => key), ['unread', 'read']);
  assert.deepEqual(keys(groupRecents(items, { ...base, groupBy: 'status', scheduled: 'hidden' })), [
    ['active', ['today', 'yesterday', 'week', 'older', 'never']],
    ['archived', ['month']],
  ]);
  assert.deepEqual(groupRecents([], { ...base, groupBy: 'date', scheduled: 'grouped' }), [], 'no empty groups');
});

test('a conversation is unread when active after it was last opened, or after first use if never opened', () => {
  const { result } = renderHook(() => useSessionViews());
  const baseline = result.current.baseline;
  const after = new Date(baseline + 60_000).toISOString();
  const before = new Date(baseline - 60_000).toISOString();
  assert.equal(isConversationUnread({ sessionId: 'a', lastActivity: before }, result.current), false, 'older history is read');
  assert.equal(isConversationUnread({ sessionId: 'a', lastActivity: after }, result.current), true);
  assert.equal(isConversationUnread({ sessionId: 'a', lastActivity: null }, result.current), false);

  act(() => markSessionViewed('a', baseline + 120_000));
  assert.equal(isConversationUnread({ sessionId: 'a', lastActivity: after }, result.current), false, 're-rendered with the new view');
  // Kept across reloads.
  resetSessionViewsCache();
  const reloaded = renderHook(() => useSessionViews()).result.current;
  assert.equal(reloaded.baseline, baseline);
  assert.equal(reloaded.views.a, baseline + 120_000);
});
