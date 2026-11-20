import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';

/** Used by the Claude runtime to inspect the actual context without estimating category sizes. Older CLIs safely return null. */
export async function readClaudeContextSnapshot(candidate: unknown): Promise<Omit<SDKControlGetContextUsageResponse, 'gridRows'> | null> {
  const client = candidate as { getContextUsage?: () => Promise<SDKControlGetContextUsageResponse> };
  if (typeof client?.getContextUsage !== 'function') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([client.getContextUsage(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2_000); })]);
    if (!snapshot || !Array.isArray(snapshot.categories) || !Number.isFinite(snapshot.maxTokens)) return null;
    // The terminal's cell grid is not needed by the web inspector; keep its real category/details data.
    const { gridRows: _grid, ...details } = snapshot;
    return details;
  } catch { return null; } finally { clearTimeout(timer); }
}
