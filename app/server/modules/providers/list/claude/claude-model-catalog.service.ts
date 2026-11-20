import os from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';

/** Used by the Claude models adapter; asks the CLI for its account-aware catalog without sending a model prompt. */
export function createClaudeModelCatalogReader(createQuery = query) {
  let cached: ModelInfo[] | null = null;
  let expires = 0;
  let pending: Promise<ModelInfo[]> | null = null;
  return async (): Promise<ModelInfo[]> => {
    if (cached && Date.now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      let release!: () => void;
      const done = new Promise<void>(resolve => { release = resolve; });
      const prompt: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({
        next: async () => { await done; return { done: true as const, value: undefined }; },
      }) };
      const executable = resolveClaudeCodeExecutablePath();
      const client = createQuery({ prompt, options: {
        cwd: os.tmpdir(), persistSession: false, settingSources: ['user'], strictMcpConfig: true, mcpServers: {}, tools: [],
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      } });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const models = await Promise.race([client.supportedModels(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Claude model catalog timed out')), 8_000);
        })]);
        if (!models.length) throw new Error('Claude returned an empty model catalog');
        cached = models; expires = Date.now() + 5 * 60_000;
        return models;
      } finally { clearTimeout(timer); release(); client.close(); }
    })();
    try { return await pending; } finally { pending = null; }
  };
}

/** Shared across Claude adapter instances to collapse simultaneous catalog requests. */
export const readClaudeModelCatalog = createClaudeModelCatalogReader();
