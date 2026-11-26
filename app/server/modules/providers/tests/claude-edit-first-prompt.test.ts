import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * Runs one turn of a session whose row maps to `old-native`, with a fake SDK
 * that reports `reportedSessionId`, and returns what the runtime asked the SDK
 * for and told the gateway writer.
 */
async function runTurn(options: { resumeFromScratch?: boolean; resumeAnchorId?: string }, reportedSessionId: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-edit-first-'));
  const sent: NormalizedMessage[] = [];
  const labelled: string[] = [];
  let sdkOptions: Record<string, unknown> | undefined;
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => 'old-native',
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sid) => sessions.normalizeMessage(raw, sid),
    isProviderInstalled: async () => true,
    createQuery: ({ prompt, options: queryOptions }) => {
      sdkOptions = queryOptions as Record<string, unknown>;
      void (async () => { for await (const _ of prompt) { /* drain stdin */ } })();
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: reportedSessionId };
        yield { type: 'result', subtype: 'success', session_id: reportedSessionId, is_error: false, usage: {} };
      })() as never;
    },
  };
  try {
    await queryClaudeSDK(
      'replacement prompt',
      { cwd, sessionId: 'app-session', ...options },
      { send: (event: NormalizedMessage) => sent.push(event), setSessionId: (id: string) => labelled.push(id), userId: null } as never,
      context,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  return { sent, labelled, sdkOptions: sdkOptions ?? {} };
}

test('a replaced first prompt starts a new provider session and announces its id', async () => {
  const { sent, labelled, sdkOptions } = await runTurn({ resumeFromScratch: true }, 'new-native');
  assert.equal(sdkOptions.resume, undefined, 'the old conversation is not resumed');
  assert.equal(sdkOptions.resumeSessionAt, undefined);
  // The gateway learns the new id both ways, which is what moves the app
  // session onto the new transcript.
  assert.deepEqual(labelled, ['new-native']);
  const created = sent.filter((event) => event.kind === 'session_created');
  assert.equal(created.length, 1);
  assert.equal(created[0].newSessionId, 'new-native');
});

test('an ordinary resume keeps the provider session and announces nothing new', async () => {
  const { sent, labelled, sdkOptions } = await runTurn({ resumeAnchorId: 'a1' }, 'old-native');
  assert.equal(sdkOptions.resume, 'old-native');
  assert.equal(sdkOptions.resumeSessionAt, 'a1');
  assert.deepEqual(labelled, []);
  assert.equal(sent.some((event) => event.kind === 'session_created'), false);
});
