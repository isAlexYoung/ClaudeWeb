import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK, resolveToolApproval } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * A tool call that names the user's sensitive information asks first, through
 * a PreToolUse hook (it runs before the permission mode, so also when
 * approvals are off). These capture the hook `queryClaudeSDK` gives the SDK,
 * call it as the SDK would, and answer through the same resolver the page's
 * permission answer reaches.
 */

type HookOutput = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
type PreToolUse = (input: Record<string, unknown>, toolUseId: string | undefined, options: { signal: AbortSignal }) => Promise<HookOutput>;

async function withRun(
  runOptions: Record<string, unknown>,
  runTest: (context: { hook: PreToolUse; sent: NormalizedMessage[] }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-sensitive-'));
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  let captured: PreToolUse | null = null;
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => { finish = resolve; });

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ options }) => {
    const hooks = (options as { hooks?: { PreToolUse?: Array<{ hooks: PreToolUse[]; timeout?: number }> } }).hooks;
    captured = hooks?.PreToolUse?.[0]?.hooks[0] ?? null;
    assert.ok((hooks?.PreToolUse?.[0]?.timeout ?? 0) * 1000 > 10 * 60_000, 'the SDK must not give up on the hook before the answer');
    const iterator = (async function* () {
      await finished;
      yield* [] as Record<string, unknown>[];
    })();
    return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} });
  };

  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    const done = queryClaudeSDK('hello', { sessionId: `app-sensitive-${Math.random()}`, cwd, ...runOptions }, writer as never, context);
    for (let attempt = 0; attempt < 200 && !captured; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    assert.ok(captured, 'queryClaudeSDK passed no PreToolUse hook to the SDK');
    await runTest({ hook: captured, sent });
    finish();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const credentials = { tool_name: 'Bash', tool_input: { command: 'cat ~/.claude/.credentials.json' }, cwd: '/tmp' };
const prompt = (sent: NormalizedMessage[]) => sent.find((message) => message.kind === 'permission_request' && message.toolName === 'ClaudeWebSensitiveAccess');

test('a call that reaches sensitive information asks first, and runs only when the user allows it', async () => {
  await withRun({}, async ({ hook, sent }) => {
    const pending = hook(credentials, 'toolu_1', { signal: new AbortController().signal });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    const request = prompt(sent);
    assert.ok(request, 'no question was sent to the page');
    assert.deepEqual((request.input as { kinds: string[] }).kinds, ['claudeCredentials']);
    assert.equal((request.input as { toolName: string }).toolName, 'Bash');
    resolveToolApproval(request.requestId as string, { allow: true });
    assert.equal((await pending).hookSpecificOutput?.permissionDecision, 'allow');
    assert.ok(sent.some((message) => message.kind === 'permission_resolved' && message.requestId === request.requestId));
  });
});

test('refusing blocks the call and tells Claude not to look for another way', async () => {
  await withRun({}, async ({ hook, sent }) => {
    const pending = hook({ tool_name: 'Bash', tool_input: { command: 'sqlite3 /var/lib/claudeweb/auth.db .dump' }, cwd: '/tmp' }, 'toolu_2', { signal: new AbortController().signal });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    resolveToolApproval(prompt(sent)?.requestId as string, { allow: false });
    const output = (await pending).hookSpecificOutput;
    assert.equal(output?.permissionDecision, 'deny');
    assert.match(output?.permissionDecisionReason ?? '', /did not allow it/);
  });
});

test('ordinary calls are not asked about, and an unattended run refuses at once', async () => {
  await withRun({}, async ({ hook, sent }) => {
    assert.deepEqual(await hook({ tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: '/tmp' }, 'toolu_3', { signal: new AbortController().signal }), {});
    assert.equal(prompt(sent), undefined);
  });
  await withRun({ unattended: true }, async ({ hook, sent }) => {
    const output = (await hook(credentials, 'toolu_4', { signal: new AbortController().signal })).hookSpecificOutput;
    assert.equal(output?.permissionDecision, 'deny');
    assert.equal(prompt(sent), undefined, 'nobody is asked in an unattended run');
  });
});
