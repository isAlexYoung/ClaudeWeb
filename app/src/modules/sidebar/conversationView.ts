import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { CHAT_WORKSPACE_PATH } from '@/shared/constants';
import type { RecentConversationListItem, RecentConversationsQuery, WorkspaceMode } from '@/shared/types';
import { readUserPreference, USER_PREFERENCES_CHANGED_EVENT, writeUserPreference } from '@/shared/userSettings';

/**
 * The sidebar's Recents: what each mode lists and how (filters, grouping,
 * sort), plus the sections the user files Chat conversations into. Stored in
 * the `sidebarConversations` preference so it follows the user across devices.
 */

export type ChatRecentsFilter = {
  status: 'active' | 'archived' | 'all';
  /** Only conversations active within this many days; null for all time. */
  sinceDays: 1 | 3 | 7 | 30 | null;
  /** Conversations started by a scheduled task: listed normally, in their own group, or left out. */
  scheduled: 'shown' | 'grouped' | 'hidden';
  groupBy: 'none' | 'date' | 'unread' | 'status';
  sort: 'activity' | 'created' | 'name';
};

export type CodeRecentsFilter = {
  sort: 'activity' | 'created' | 'name';
  order: 'asc' | 'desc';
};

export type ConversationSection = { id: string; name: string };

export type SidebarConversationPrefs = {
  chat: ChatRecentsFilter;
  code: CodeRecentsFilter;
  sections: ConversationSection[];
  /** Which section each filed conversation is in. */
  sessionSections: Record<string, string>;
  collapsed: { chatRecent: boolean; codeRecent: boolean; sections: Record<string, boolean> };
};

export const DEFAULT_CONVERSATION_PREFS: SidebarConversationPrefs = {
  chat: { status: 'active', sinceDays: null, scheduled: 'shown', groupBy: 'none', sort: 'activity' },
  code: { sort: 'activity', order: 'desc' },
  sections: [],
  sessionSections: {},
  collapsed: { chatRecent: false, codeRecent: false, sections: {} },
};

const PREFERENCE_KEY = 'sidebarConversations';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (
  allowed.includes(value as T) ? (value as T) : fallback
);

/** Reads a stored value of any age or shape into a complete, valid set of preferences. */
export function normalizeConversationPrefs(value: unknown): SidebarConversationPrefs {
  const stored = isRecord(value) ? value : {};
  const chat = isRecord(stored.chat) ? stored.chat : {};
  const code = isRecord(stored.code) ? stored.code : {};
  const collapsed = isRecord(stored.collapsed) ? stored.collapsed : {};
  const defaults = DEFAULT_CONVERSATION_PREFS;
  const sections = (Array.isArray(stored.sections) ? stored.sections : [])
    .filter((section): section is ConversationSection => isRecord(section)
      && typeof section.id === 'string' && section.id !== ''
      && typeof section.name === 'string' && section.name.trim() !== '')
    .map((section) => ({ id: section.id, name: section.name }));
  const sectionIds = new Set(sections.map((section) => section.id));
  const sessionSections = Object.fromEntries(Object.entries(isRecord(stored.sessionSections) ? stored.sessionSections : {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && sectionIds.has(entry[1])));
  const collapsedSections = Object.fromEntries(Object.entries(isRecord(collapsed.sections) ? collapsed.sections : {})
    .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean' && sectionIds.has(entry[0])));
  return {
    chat: {
      status: pick(chat.status, ['active', 'archived', 'all'] as const, defaults.chat.status),
      sinceDays: pick(chat.sinceDays, [1, 3, 7, 30, null] as const, defaults.chat.sinceDays),
      scheduled: pick(chat.scheduled, ['shown', 'grouped', 'hidden'] as const, defaults.chat.scheduled),
      groupBy: pick(chat.groupBy, ['none', 'date', 'unread', 'status'] as const, defaults.chat.groupBy),
      sort: pick(chat.sort, ['activity', 'created', 'name'] as const, defaults.chat.sort),
    },
    code: {
      sort: pick(code.sort, ['activity', 'created', 'name'] as const, defaults.code.sort),
      order: pick(code.order, ['asc', 'desc'] as const, defaults.code.order),
    },
    sections,
    sessionSections,
    collapsed: {
      chatRecent: collapsed.chatRecent === true,
      codeRecent: collapsed.codeRecent === true,
      sections: collapsedSections,
    },
  };
}

const subscribe = (onChange: () => void) => {
  window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, onChange);
};
const readStored = () => readUserPreference<unknown>(PREFERENCE_KEY, null);

/** The current preferences, and a function that changes them (saved to the server). */
export function useSidebarConversationPrefs(): [SidebarConversationPrefs, (change: (prefs: SidebarConversationPrefs) => SidebarConversationPrefs) => void] {
  const stored = useSyncExternalStore(subscribe, readStored, readStored);
  const prefs = useMemo(() => normalizeConversationPrefs(stored), [stored]);
  const update = useCallback((change: (prefs: SidebarConversationPrefs) => SidebarConversationPrefs) => {
    writeUserPreference(PREFERENCE_KEY, change(normalizeConversationPrefs(readStored())));
  }, []);
  return [prefs, update];
}

/** What the server is asked for: only this mode's conversations, filtered and ordered as chosen. */
export function recentsQuery(mode: WorkspaceMode, prefs: SidebarConversationPrefs): RecentConversationsQuery {
  if (mode === 'chat') {
    return {
      scope: 'chat',
      chatPath: CHAT_WORKSPACE_PATH,
      status: prefs.chat.status,
      sinceDays: prefs.chat.sinceDays,
      sort: prefs.chat.sort,
    };
  }
  return { scope: 'project', chatPath: CHAT_WORKSPACE_PATH, sort: prefs.code.sort, order: prefs.code.order };
}

export function addSection(prefs: SidebarConversationPrefs, section: ConversationSection, moveSessionId?: string | null): SidebarConversationPrefs {
  const next = { ...prefs, sections: [...prefs.sections, section] };
  return moveSessionId ? moveToSection(next, moveSessionId, section.id) : next;
}

export function renameSection(prefs: SidebarConversationPrefs, id: string, name: string): SidebarConversationPrefs {
  return { ...prefs, sections: prefs.sections.map((section) => (section.id === id ? { ...section, name } : section)) };
}

/** Removes a section; its conversations go back to Recents. */
export function removeSection(prefs: SidebarConversationPrefs, id: string): SidebarConversationPrefs {
  const sessionSections = Object.fromEntries(Object.entries(prefs.sessionSections).filter(([, sectionId]) => sectionId !== id));
  const sections = Object.fromEntries(Object.entries(prefs.collapsed.sections).filter(([sectionId]) => sectionId !== id));
  return {
    ...prefs,
    sections: prefs.sections.filter((section) => section.id !== id),
    sessionSections,
    collapsed: { ...prefs.collapsed, sections },
  };
}

/** Files a conversation into a section, or back into Recents with null. */
export function moveToSection(prefs: SidebarConversationPrefs, sessionId: string, sectionId: string | null): SidebarConversationPrefs {
  const sessionSections = { ...prefs.sessionSections };
  if (sectionId) sessionSections[sessionId] = sectionId;
  else delete sessionSections[sessionId];
  return { ...prefs, sessionSections };
}

// ---------------------------------------------------------------- grouping

export type RecentGroupKey =
  | 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'older'
  | 'unread' | 'read' | 'active' | 'archived' | 'scheduled';

export type RecentGroup = { key: RecentGroupKey; items: RecentConversationListItem[] };

/** SQLite's `YYYY-MM-DD HH:MM:SS` carries no zone and is UTC; ISO strings are read as written. */
export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = /[TZ+]/.test(value.slice(10)) ? value : `${value.replace(' ', 'T')}Z`;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

const DAY = 24 * 60 * 60 * 1000;

function dateGroup(lastActivity: string | null | undefined, now: Date): RecentGroupKey {
  const time = parseTimestamp(lastActivity);
  if (time === null) return 'older';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= startOfToday) return 'today';
  if (time >= startOfToday - DAY) return 'yesterday';
  if (time >= startOfToday - 7 * DAY) return 'week';
  if (time >= startOfToday - 30 * DAY) return 'month';
  return 'older';
}

const GROUP_ORDER: Record<ChatRecentsFilter['groupBy'], RecentGroupKey[]> = {
  none: ['all'],
  date: ['today', 'yesterday', 'week', 'month', 'older'],
  unread: ['unread', 'read'],
  status: ['active', 'archived'],
};

/**
 * Splits the loaded Recents into the groups shown under their headings. The
 * server has already filtered and sorted them; this keeps that order inside
 * each group. Scheduled-task conversations are dropped, or gathered last.
 */
export function groupRecents(items: RecentConversationListItem[], options: {
  groupBy: ChatRecentsFilter['groupBy'];
  scheduled: ChatRecentsFilter['scheduled'];
  scheduledIds: ReadonlySet<string>;
  isUnread: (item: RecentConversationListItem) => boolean;
  now?: Date;
}): RecentGroup[] {
  const now = options.now ?? new Date();
  const buckets = new Map<RecentGroupKey, RecentConversationListItem[]>();
  const scheduled: RecentConversationListItem[] = [];
  for (const item of items) {
    if (options.scheduledIds.has(item.sessionId)) {
      if (options.scheduled === 'hidden') continue;
      if (options.scheduled === 'grouped') { scheduled.push(item); continue; }
    }
    const key: RecentGroupKey = options.groupBy === 'date'
      ? dateGroup(item.lastActivity, now)
      : options.groupBy === 'unread'
        ? (options.isUnread(item) ? 'unread' : 'read')
        : options.groupBy === 'status'
          ? (item.isArchived ? 'archived' : 'active')
          : 'all';
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  const groups: RecentGroup[] = GROUP_ORDER[options.groupBy]
    .map((key) => ({ key, items: buckets.get(key) ?? [] }))
    .filter((group) => group.items.length > 0);
  if (scheduled.length > 0) groups.push({ key: 'scheduled', items: scheduled });
  return groups;
}

// ---------------------------------------------------------------- unread

/**
 * When each conversation was last open on this device. A conversation whose
 * last activity is newer is unread; one never opened counts from the moment
 * this was first used, so existing history does not all turn unread at once.
 */
type SessionViews = { baseline: number; views: Record<string, number> };

const VIEWS_STORAGE_KEY = 'sidebar-session-views';
const VIEWS_CHANGED_EVENT = 'sidebar-session-views:changed';
const MAX_VIEWS = 500;

let cachedViews: SessionViews | null = null;

function readViews(): SessionViews {
  if (cachedViews) return cachedViews;
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(VIEWS_STORAGE_KEY) ?? 'null');
  } catch {
    stored = null;
  }
  if (isRecord(stored) && typeof stored.baseline === 'number' && isRecord(stored.views)) {
    cachedViews = {
      baseline: stored.baseline,
      views: Object.fromEntries(Object.entries(stored.views).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
    };
  } else {
    cachedViews = { baseline: Date.now(), views: {} };
    writeViews(cachedViews);
  }
  return cachedViews;
}

function writeViews(views: SessionViews): void {
  try {
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Without storage, unread marks last only until the page reloads.
  }
}

/** Records that a conversation is open (or was just left) now. */
export function markSessionViewed(sessionId: string, at: number = Date.now()): void {
  const current = readViews();
  const entries = Object.entries({ ...current.views, [sessionId]: at })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VIEWS);
  cachedViews = { baseline: current.baseline, views: Object.fromEntries(entries) };
  writeViews(cachedViews);
  window.dispatchEvent(new Event(VIEWS_CHANGED_EVENT));
}

export function isConversationUnread(item: Pick<RecentConversationListItem, 'sessionId' | 'lastActivity'>, views: SessionViews): boolean {
  const activity = parseTimestamp(item.lastActivity);
  if (activity === null) return false;
  return activity > (views.views[item.sessionId] ?? views.baseline);
}

const subscribeViews = (onChange: () => void) => {
  window.addEventListener(VIEWS_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(VIEWS_CHANGED_EVENT, onChange);
};

/** The per-device record of opened conversations; re-renders when one is marked. */
export function useSessionViews(): SessionViews {
  return useSyncExternalStore(subscribeViews, readViews, readViews);
}

/** Forgets the cached record; for tests that reset localStorage. */
export function resetSessionViewsCache(): void {
  cachedViews = null;
}
