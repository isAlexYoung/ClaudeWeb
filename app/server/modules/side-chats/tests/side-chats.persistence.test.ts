import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, sideChatsDb } from '@/modules/database/index.js';

// This file runs in its own node:test process; no developer or production database is opened.
test('saved conversations survive reopening SQLite, are owner-scoped, and interrupted runs become retryable', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claudeweb-sidechats-'));
  const previous = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(directory, 'side-chats-test.db');
  try {
    const chat: NonNullable<ReturnType<typeof sideChatsDb.get>> = {
      id: 'side-1', parentSessionId: 'main-1', projectId: 'p1', cwd: directory, context: 'snapshot', model: 'opus', effort: 'high',
      source: { id: 'quote-1', text: 'original', messageKey: 'key', role: 'assistant', kind: 'text', startOffset: 0, timestamp: '2026-11-18' },
      createdAt: new Date().toISOString(), minimized: true, position: { x: 70, y: 90, width: 400, height: 300 }, draft: 'retained question',
      status: 'running', messages: [{ id: 'u1', role: 'user', content: 'hello' }],
    };
    sideChatsDb.insert(1, chat); assert.equal(sideChatsDb.list(2, 'main-1').length, 0);
    closeConnection();
    const restored = sideChatsDb.get(1, chat.id)!;
    assert.equal(restored.draft, 'retained question'); assert.equal(restored.minimized, true);
    assert.equal(restored.status, 'error'); assert.equal(restored.error, 'SIDECAR_RESTARTED');
    assert.deepEqual(restored.messages, chat.messages);
    sideChatsDb.delete(1, chat.id); sideChatsDb.update(1, chat);
    assert.equal(sideChatsDb.get(1, chat.id), null);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
