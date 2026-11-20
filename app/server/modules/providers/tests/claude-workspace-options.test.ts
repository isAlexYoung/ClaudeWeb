import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProviderRuntimeContext } from '@/shared/types.js';
import { CLAUDE_PREDEFINED_MODELS } from '../list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '../list/claude/claude-runtime.provider.js';

async function capture(options: Record<string, unknown>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'workspace-sdk-'));
  let passed: Record<string, unknown> | null = null;
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery: ({ options: sdkOptions, prompt }) => {
      passed = sdkOptions;
      void (async () => { for await (const _message of prompt) { /* drain */ } })();
      return Object.assign((async function* () { /* no paid model call */ })(), { interrupt: async () => {} }) as never;
    },
  };
  try {
    await queryClaudeSDK('hello', { sessionId: 'workspace-sdk-test', cwd, ...options }, { send: () => {}, userId: null } as never, context);
    assert.ok(passed, 'runtime never created an SDK query');
    return passed as Record<string, unknown>;
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

test('chat MCP off prevents inherited MCP discovery and fast mode uses SDK settings', async () => {
  const options = await capture({ mcpEnabled: false, fastMode: true, model: 'opus' });
  assert.equal(options.strictMcpConfig, true);
  assert.deepEqual(options.mcpServers, {});
  assert.equal((options.settings as Record<string, unknown>).fastMode, true);
});

test('unsupported fast models are not enabled; Ultracode maps to actual SDK settings', async () => {
  const options = await capture({ mcpEnabled: true, fastMode: true, model: 'sonnet', effort: 'ultracode' });
  assert.notEqual(options.strictMcpConfig, true);
  assert.equal(options.effort, 'xhigh');
  assert.deepEqual(options.settings, { ultracode: true, enableWorkflows: true, fastMode: false });
});
