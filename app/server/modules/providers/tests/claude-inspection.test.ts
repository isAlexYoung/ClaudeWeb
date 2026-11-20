import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { query } from '@anthropic-ai/claude-agent-sdk';

import { createClaudeModelCatalogReader } from '../list/claude/claude-model-catalog.service.js';
import { readClaudeContextSnapshot } from '../list/claude/claude-context-snapshot.service.js';
import { queryClaudeSDK } from '../list/claude/claude-runtime.provider.js';
import { ClaudeSessionsProvider } from '../list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '../list/claude/claude-models.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

test('model discovery never sends a paid prompt or saves a session, and concurrent readers share its result', async () => {
  let started = 0; let closed = 0; let supplied: Record<string, unknown> | undefined;
  const models = [{ value: 'fable', displayName: 'Fable 5.2', description: 'Available to this account' }];
  const read = createClaudeModelCatalogReader(((request: { options: Record<string, unknown> }) => {
    started++; supplied = request.options;
    return { supportedModels: async () => models, close: () => { closed++; } };
  }) as unknown as typeof query);
  const results = await Promise.all([read(), read()]);
  assert.deepEqual(results, [models, models]);
  await read();
  assert.equal(started, 1); assert.equal(closed, 1);
  assert.equal(supplied?.persistSession, false);
  assert.equal(supplied?.strictMcpConfig, true);
  assert.deepEqual(supplied?.mcpServers, {});
});

test('context inspection preserves the SDK category data and omits only the terminal grid', async () => {
  const snapshot = { maxTokens: 1_000_000, totalTokens: 320_000, percentage: 32, categories: [{ name: 'Messages', tokens: 269_200, color: 'blue' }], gridRows: [[{ tokens: 1 }]] };
  const result = await readClaudeContextSnapshot({ getContextUsage: async () => snapshot });
  assert.equal(result?.maxTokens, 1_000_000);
  assert.deepEqual(result?.categories, snapshot.categories);
  assert.equal('gridRows' in (result || {}), false);
});

test('an older CLI or a rejected control request falls back without inventing category data', async () => {
  assert.equal(await readClaudeContextSnapshot({}), null);
  assert.equal(await readClaudeContextSnapshot({ getContextUsage: async () => { throw new Error('unsupported'); } }), null);
});

test('runtime forwards real context snapshots and rate limits to the stable app session', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-inspection-'));
  const sent: NormalizedMessage[] = [];
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const snapshot = { maxTokens: 1_000_000, totalTokens: 320_000, categories: [{ name: 'Messages', tokens: 320_000, color: 'blue' }] };
  const limit = { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 2_000_000_000 };
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery: () => Object.assign((async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'native-inspection' };
      yield { type: 'rate_limit_event', rate_limit_info: limit, session_id: 'native-inspection' };
      yield { type: 'result', subtype: 'success', session_id: 'native-inspection', result: 'done', duration_ms: 1, num_turns: 1 };
    })(), { interrupt: async () => {}, getContextUsage: async () => snapshot }),
  };
  try {
    await queryClaudeSDK('hello', { sessionId: 'app-inspection', cwd }, { send: (message: NormalizedMessage) => sent.push(message), userId: null } as never, context);
    const usage = sent.filter(message => message.text === 'context_usage');
    assert.equal(usage.length, 2);
    assert.ok(usage.every(message => message.sessionId === 'app-inspection'));
    assert.deepEqual(usage[0].contextUsage, snapshot);
    assert.deepEqual(sent.find(message => message.text === 'usage_limit')?.usageLimit, limit);
    assert.ok(sent.some(message => message.kind === 'complete'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
