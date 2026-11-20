import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

for (const enabled of [true, false]) {
  test(`native suggestions after result: enabled=${enabled}`, async (t) => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-suggestion-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const sent: NormalizedMessage[] = [];
    let released = false;
    const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null, resolveResumeModel: async () => undefined,
      getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
      normalizeMessage: (raw, sid) => sessions.normalizeMessage(raw, sid), isProviderInstalled: async () => true,
      createQuery: ({ prompt, options }) => {
        assert.equal(options?.promptSuggestions, enabled);
        void (async () => { for await (const _ of prompt) { /* observe stdin closing */ } released = true; })();
        return (async function* () {
          yield { type: 'system', subtype: 'init', session_id: 'native' };
          yield { type: 'result', subtype: 'success', session_id: 'native', is_error: false, usage: {} };
          await new Promise(resolve => setTimeout(resolve, 5));
          assert.ok(sent.some(event => event.kind === 'complete'), 'UI completion must precede the suggestion');
          if (enabled) assert.equal(released, false, 'stdin closed before the native suggestion');
          yield { type: 'prompt_suggestion', suggestion: '发布 1.0.5', session_id: 'native', uuid: 'suggestion' };
        })() as never;
      },
    };
    await queryClaudeSDK('continue', { cwd, sessionId: 'app-suggestion', promptSuggestions: enabled }, { send: (event: NormalizedMessage) => sent.push(event), userId: null } as never, context);
    const suggestion = sent.find(event => event.kind === 'status' && event.text === 'prompt_suggestion');
    if (enabled) {
      assert.equal(suggestion?.content, '发布 1.0.5');
      assert.equal(suggestion?.sessionId, 'app-suggestion');
      assert.equal(suggestion?.requestId, sent.find(event => event.text === 'prompt_suggestion_turn')?.requestId);
    } else {
      assert.equal(suggestion, undefined);
    }
    assert.equal(released, true);
  });
}
