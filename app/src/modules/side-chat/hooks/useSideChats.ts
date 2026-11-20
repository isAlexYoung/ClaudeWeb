import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '@/shared/api';
import type { SideChat, TextQuote } from '@/shared/types';

type Snapshot = { chats: SideChat[]; loading: boolean; error: string | null };
type Store = { snapshot: Snapshot; listeners: Set<() => void>; ticket: number; pending: number; queue: Promise<unknown>; deleted: Set<string>; timer?: ReturnType<typeof setTimeout> };
const stores = new Map<string, Store>();
const empty: Snapshot = { chats: [], loading: false, error: null };
function storeFor(parent: string) {
  let store = stores.get(parent);
  if (!store) {
    store = { snapshot: empty, listeners: new Set(), ticket: 0, pending: 0, queue: Promise.resolve(), deleted: new Set() };
    stores.set(parent, store);
  }
  return store;
}
function publish(store: Store, patch: Partial<Snapshot>) {
  store.snapshot = { ...store.snapshot, ...patch };
  store.listeners.forEach(listener => listener());
}
async function response<T>(request: Promise<Response>): Promise<T> {
  const res = await request;
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.code || body?.code || body?.error || body?.message || `HTTP ${res.status}`);
  return body as T;
}
function schedule(parent: string, store: Store) {
  clearTimeout(store.timer);
  if (!store.listeners.size) return;
  store.timer = setTimeout(() => void refresh(parent), store.snapshot.chats.some(c => c.status === 'running') ? 700 : 7000);
}
async function refresh(parent: string) {
  if (!parent) return;
  const store = storeFor(parent);
  if (store.pending) { schedule(parent, store); return; }
  const ticket = ++store.ticket;
  try {
    const chats = await response<SideChat[]>(api.sideChats.list(parent));
    if (ticket === store.ticket && !store.pending) publish(store, { chats: chats.filter(c => !store.deleted.has(c.id)), error: null, loading: false });
  } catch (e) {
    if (ticket === store.ticket) publish(store, { loading: false, error: String(e instanceof Error ? e.message : e) });
  } finally { schedule(parent, store); }
}
async function mutate(parent: string, operation: () => Promise<SideChat | void>) {
  const store = storeFor(parent);
  store.pending++; store.ticket++;
  const preceding = store.queue;
  let release!: () => void;
  store.queue = new Promise(resolve => { release = () => resolve(undefined); });
  await preceding.catch(() => undefined);
  try {
    const chat = await operation();
    if (chat && !store.deleted.has(chat.id)) {
      const found = store.snapshot.chats.some(c => c.id === chat.id);
      publish(store, { chats: found ? store.snapshot.chats.map(c => c.id === chat.id ? chat : c) : [...store.snapshot.chats, chat], error: null });
    }
    return chat;
  } catch (e) {
    publish(store, { error: String(e instanceof Error ? e.message : e) });
    throw e;
  } finally { store.pending--; release(); schedule(parent, store); }
}

/** Used by the transcript and inspector so both operate on one session-scoped side-chat collection. */
export function useSideChats(parent: string | null) {
  const store = storeFor(parent || '');
  const subscribe = useCallback((listener: () => void) => {
    store.listeners.add(listener);
    schedule(parent || '', store);
    return () => { store.listeners.delete(listener); if (!store.listeners.size) clearTimeout(store.timer); };
  }, [parent, store]);
  const state = useSyncExternalStore(subscribe, () => parent ? store.snapshot : empty);
  useEffect(() => {
    if (parent) { publish(store, { loading: !store.snapshot.chats.length }); void refresh(parent); }
    return () => { if (!store.listeners.size) clearTimeout(store.timer); };
  }, [parent, store]);
  return {
    ...state,
    refresh: () => refresh(parent || ''),
    create: (source: TextQuote, context: string, model: string, effort: string) => mutate(parent!, () => response<SideChat>(api.sideChats.create({ parentSessionId: parent, source, context, model, effort }))),
    update: (id: string, patch: Partial<SideChat>) => mutate(parent!, () => response<SideChat>(api.sideChats.update(id, patch))),
    send: (id: string, content: string) => mutate(parent!, () => response<SideChat>(api.sideChats.send(id, content))),
    stop: (id: string) => mutate(parent!, () => response<SideChat>(api.sideChats.stop(id))),
    remove: async (id: string) => {
      // Invalidate pending list reads immediately so a slow poll cannot bring back a deleted row.
      store.deleted.add(id);
      const previous = store.snapshot.chats;
      publish(store, { chats: previous.filter(c => c.id !== id) });
      try { await mutate(parent!, async () => { await response(api.sideChats.remove(id)); }); }
      catch (e) { store.deleted.delete(id); publish(store, { chats: previous }); throw e; }
    },
  };
}
