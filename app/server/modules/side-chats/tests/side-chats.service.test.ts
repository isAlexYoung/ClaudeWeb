import assert from 'node:assert/strict';
import test from 'node:test';
import { createSideChatsService } from '@/modules/side-chats/side-chats.service.js';
import type { sideChatsDb } from '@/modules/database/index.js';
import type { streamClaudeSideQuestion } from '@/modules/providers/index.js';

type Stored = NonNullable<ReturnType<typeof sideChatsDb.get>>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function harness(generate: typeof streamClaudeSideQuestion = async function* () { yield 'answer'; }) {
  const rows = new Map<string, Stored>();
  const repository: typeof sideChatsDb = {
    list: (user, parent) => [...rows.entries()].filter(([key, chat]) => key.startsWith(`${user}:`) && chat.parentSessionId === parent).map(([, chat]) => clone(chat)),
    get: (user, id) => rows.has(`${user}:${id}`) ? clone(rows.get(`${user}:${id}`)!) : null,
    insert: (user, chat) => { rows.set(`${user}:${chat.id}`, clone(chat)); },
    update: (user, chat) => { if (rows.has(`${user}:${chat.id}`)) rows.set(`${user}:${chat.id}`, clone(chat)); },
    delete: (user, id) => { rows.delete(`${user}:${id}`); },
  };
  const service = createSideChatsService({ repository, generate, resolveParent: id => id === 'missing' ? null : ({ projectId: 'p1', cwd: '/workspace/project', provider: 'claude', model: 'opus', effort: 'high' }) });
  const create = (parent = 'main') => service.create(1, { parentSessionId: parent, context: 'snapshot before new main tokens', model: 'opus', effort: 'high',
    source: { messageKey: 'message-assistant-source', text: 'original excerpt', role: 'assistant', kind: 'thinking', timestamp: '2026-11-18T01:00:00Z', startOffset: 0 } });
  return { service, repository, create };
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 10));

test('side chats inherit model/effort, snapshot their origin and remain separate by parent and account', () => {
  const h = harness(); const first = h.create(); const second = h.create('other');
  assert.deepEqual(h.service.list(1, 'main').map(c => c.id), [first.id]);
  assert.deepEqual(h.service.list(1, 'other').map(c => c.id), [second.id]);
  assert.deepEqual(h.service.list(2, 'main'), []);
  assert.equal(first.model, 'opus'); assert.equal(first.effort, 'high');
  assert.equal(first.source.kind, 'thinking');
  assert.equal('context' in first, false); assert.equal('cwd' in first, false);
  assert.throws(() => h.service.update(2, first.id, { minimized: true }), /SIDE_CHAT_NOT_FOUND/);
  assert.throws(() => h.create('missing'), /SIDE_CHAT_PARENT_NOT_FOUND/);
});

test('minimizing continues generation; geometry and draft edits survive streamed commits', async () => {
  let release!: () => void; let prompt = '';
  const h = harness(async function* (input) { prompt = input.prompt; yield 'first'; await new Promise<void>(resolve => { release = resolve; }); yield ' second'; });
  const chat = h.create(); h.service.send(1, chat.id, 'Is this thought correct?');
  await settle();
  h.service.update(1, chat.id, { minimized: true, draft: 'another thought', position: { x: 200, y: 150, width: 600, height: 400 } });
  assert.throws(() => h.service.send(1, chat.id, 'duplicate'), /SIDE_CHAT_BUSY/);
  release(); await settle();
  const saved = h.service.list(1, 'main')[0];
  assert.equal(saved.messages.at(-1)?.content, 'first second'); assert.equal(saved.status, 'idle');
  assert.equal(saved.minimized, true); assert.equal(saved.draft, 'another thought'); assert.equal(saved.position.width, 600);
  assert.match(prompt, /snapshot before new main tokens/); assert.match(prompt, /original excerpt/); assert.match(prompt, /Is this thought correct/);
});

test('deletion cancels generation and a late result never restores the deleted record', async () => {
  let release!: () => void; let controller!: AbortController;
  const h = harness(async function* (input) { controller = input.controller; yield 'first'; await new Promise<void>(resolve => { release = resolve; }); yield 'late'; });
  const first = h.create(), second = h.create(); h.service.send(1, first.id, 'question'); await settle();
  h.service.remove(1, first.id); assert.equal(controller.signal.aborted, true);
  release(); await settle();
  assert.deepEqual(h.service.list(1, 'main').map(c => c.id), [second.id]);
  assert.equal(h.repository.get(1, first.id), null);
});

test('stop is independent of the main session and permits a new side question without late overwrites', async () => {
  let release!: () => void; let calls = 0;
  const h = harness(async function* () { if (++calls === 1) { yield 'partial'; await new Promise<void>(resolve => { release = resolve; }); yield 'stale'; } else yield 'fresh'; });
  const chat = h.create(); h.service.send(1, chat.id, 'one'); await settle(); h.service.stop(1, chat.id);
  h.service.send(1, chat.id, 'two'); await settle(); release(); await settle();
  const saved = h.service.list(1, 'main')[0];
  assert.equal(saved.messages.at(-1)?.content, 'fresh'); assert.equal(saved.status, 'idle');
});

test('SDK failures retain the user question, partial answer and an actionable error', async () => {
  const h = harness(async function* () { yield 'partial'; throw new Error('quota exceeded'); });
  const chat = h.create(); h.service.send(1, chat.id, 'why'); await settle();
  const saved = h.service.list(1, 'main')[0];
  assert.equal(saved.status, 'error'); assert.equal(saved.error, 'quota exceeded'); assert.equal(saved.messages[0].content, 'why');
  assert.equal(saved.messages[1].content, 'partial');
});
