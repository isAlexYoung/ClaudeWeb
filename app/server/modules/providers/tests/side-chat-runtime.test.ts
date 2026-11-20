import assert from 'node:assert/strict';
import test from 'node:test';

import type { query } from '@anthropic-ai/claude-agent-sdk';

import { streamClaudeSideQuestion } from '@/modules/providers/list/claude/claude-runtime.provider.js';

test('side Q&A disables tools, MCP, hooks, auto-memory, transcript persistence and main-session resume', async () => {
  let options: Record<string, any> = {}; let closed = false;
  const fakeQuery = ((input: { options: Record<string, any> }) => {
    options = input.options;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
      },
      close() { closed = true; },
    };
  }) as unknown as typeof query;
  const controller = new AbortController();
  const chunks: string[] = [];
  for await (const chunk of streamClaudeSideQuestion({ prompt: 'snapshot', cwd: process.cwd(), model: 'opus', effort: 'high', controller }, fakeQuery)) chunks.push(chunk);
  assert.deepEqual(chunks, ['hello']); assert.equal(closed, true);
  assert.deepEqual(options.tools, []); assert.deepEqual(options.mcpServers, {}); assert.deepEqual(options.settingSources, []);
  assert.equal(options.strictMcpConfig, true); assert.equal(options.persistSession, false);
  assert.equal(options.settings.autoMemoryEnabled, false); assert.equal(options.settings.disableAllHooks, true);
  assert.equal(options.resume, undefined); assert.equal(options.forkSession, undefined); assert.equal(options.abortController, controller);
  assert.equal((await options.canUseTool('Write', {})).behavior, 'deny');
});
