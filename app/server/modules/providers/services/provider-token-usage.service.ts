import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { AnyRecord } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type SessionRow = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;

type FileTail = {
  content: string;
  /** True when `content` is the whole file, not just its trailing bytes. */
  isComplete: boolean;
};

type ProviderTokenUsageServiceDependencies = {
  getSessionById: (sessionId: string) => SessionRow | null | undefined;
  getHomeDirectory: () => string;
  fileExists: (filePath: string) => boolean;
  readTextFile: (filePath: string) => Promise<string>;
  readTextFileTail: (filePath: string, maxBytes: number) => Promise<FileTail>;
  getClaudeContextWindow: () => string | undefined;
  getReportedClaudeContextWindow: (providerSessionId: string) => number | undefined;
  isProviderSessionSuperseded: (providerSessionId: string, provider: string) => boolean;
};

type TokenUsageResult = {
  used: number;
  total?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cacheTokens?: number;
  breakdown: {
    input: number;
    output: number;
  };
  unsupported?: boolean;
  message?: string;
};

/**
 * Both JSONL usage readers below only need the newest usage row, which sits at
 * or near the end of the transcript. Reading just this much of the tail keeps
 * a session-open usage lookup O(1) in the transcript's size; the rare tail
 * with no usage row at all falls back to the full read.
 */
const TOKEN_USAGE_TAIL_BYTES = 4 * 1024 * 1024;

const defaultDependencies: ProviderTokenUsageServiceDependencies = {
  getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
  getHomeDirectory: () => os.homedir(),
  fileExists: (filePath) => fsSync.existsSync(filePath),
  readTextFile: (filePath) => fsp.readFile(filePath, 'utf8'),
  readTextFileTail: async (filePath, maxBytes) => {
    const handle = await fsp.open(filePath, 'r');
    try {
      const { size } = await handle.stat();
      if (size <= maxBytes) {
        return { content: await handle.readFile({ encoding: 'utf8' }), isComplete: true };
      }

      const buffer = Buffer.alloc(maxBytes);
      await handle.read(buffer, 0, maxBytes, size - maxBytes);
      const content = buffer.toString('utf8');
      // The window almost never starts on a row boundary; dropping everything
      // up to the first newline discards the partial row (and any split
      // multi-byte character with it).
      const firstNewline = content.indexOf('\n');
      return {
        content: firstNewline === -1 ? '' : content.slice(firstNewline + 1),
        isComplete: false,
      };
    } finally {
      await handle.close();
    }
  },
  getClaudeContextWindow: () => process.env.CONTEXT_WINDOW,
  getReportedClaudeContextWindow: (providerSessionId) => getReportedClaudeContextWindow(providerSessionId),
  isProviderSessionSuperseded: (providerSessionId, provider) =>
    sessionsDb.isProviderSessionSuperseded(providerSessionId, provider),
};

/**
 * Context windows the Claude SDK reported per provider session id.
 *
 * The SDK states the real window of the model that served a turn only in the
 * turn's `result.modelUsage[model].contextWindow`; the transcript records the
 * model id at most, and an id cannot tell a 200K from a 1M variant, nor what a
 * self-hosted model behind ANTHROPIC_BASE_URL allows. Remembering the reported
 * value lets the history-derived usage show the same window the live counter
 * did. It is process memory on purpose: after a restart the counter falls back
 * to CONTEXT_WINDOW until the session's next turn reports again.
 */
const reportedClaudeContextWindows = new Map<string, number>();

/** One number per session; the cap only bounds a long-lived server's memory. */
const MAX_REPORTED_CLAUDE_CONTEXT_WINDOWS = 1000;

/**
 * Used by the Claude runtime provider to record the window the SDK reported for
 * a session's turn. Non-positive or non-numeric values are ignored so a build
 * that reports no window never overwrites one that did.
 */
export function rememberClaudeContextWindow(providerSessionId: string, contextWindow: number): void {
  if (!providerSessionId || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return;
  }

  // Re-insert so the most recently reported sessions are the last evicted.
  reportedClaudeContextWindows.delete(providerSessionId);
  reportedClaudeContextWindows.set(providerSessionId, contextWindow);
  if (reportedClaudeContextWindows.size > MAX_REPORTED_CLAUDE_CONTEXT_WINDOWS) {
    const oldestSessionId = reportedClaudeContextWindows.keys().next().value;
    if (oldestSessionId !== undefined) {
      reportedClaudeContextWindows.delete(oldestSessionId);
    }
  }
}

/**
 * Used by the Claude runtime provider (a resumed run starts from the window its
 * session last reported), the Claude history reader, and this service's usage
 * lookup. Returns undefined when no run has reported a window for the session.
 */
export function getReportedClaudeContextWindow(providerSessionId: string | null | undefined): number | undefined {
  return providerSessionId ? reportedClaudeContextWindows.get(providerSessionId) : undefined;
}

/**
 * The largest context each session has been seen holding: a turn's whole
 * prompt, or the size a compaction started from. A window can never be smaller
 * than that, which is what lets `inferClaudeContextWindow` correct a window it
 * would otherwise take from CONTEXT_WINDOW — after a restart, or during a long
 * turn whose `result` (the only message that states the window) has not come
 * yet. Process memory like the map above, and filled from both the live stream
 * and the transcript reads, so either side can tell the other.
 */
const observedClaudeContextTokens = new Map<string, number>();

/** Used by the Claude runtime provider and the transcript readers below; keeps the largest value per session. */
export function noteObservedClaudeContextTokens(providerSessionId: string | null | undefined, tokens: number): void {
  if (!providerSessionId || !Number.isFinite(tokens) || tokens <= 0) {
    return;
  }
  const previous = observedClaudeContextTokens.get(providerSessionId) ?? 0;
  if (tokens <= previous) {
    return;
  }
  observedClaudeContextTokens.delete(providerSessionId);
  observedClaudeContextTokens.set(providerSessionId, tokens);
  if (observedClaudeContextTokens.size > MAX_REPORTED_CLAUDE_CONTEXT_WINDOWS) {
    const oldestSessionId = observedClaudeContextTokens.keys().next().value;
    if (oldestSessionId !== undefined) {
      observedClaudeContextTokens.delete(oldestSessionId);
    }
  }
}

/** Used by the Claude runtime provider to start a resumed run from what the transcript showed. */
export function getObservedClaudeContextTokens(providerSessionId: string | null | undefined): number {
  return providerSessionId ? observedClaudeContextTokens.get(providerSessionId) ?? 0 : 0;
}

/** Context-window sizes Claude models come in, smallest first. */
const CLAUDE_CONTEXT_WINDOW_TIERS = [200_000, 1_000_000];

/** The CONTEXT_WINDOW setting, or 160K when it is unset or unreadable. */
export function readConfiguredClaudeContextWindow(configured: string | undefined = process.env.CONTEXT_WINDOW): number {
  const parsed = Number.parseInt(configured ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 160_000;
}

/**
 * The window a session's usage is measured against.
 *
 * The SDK-reported window wins. Without one, the configured window stands
 * unless something proves it too small: a model selected with the `[1m]`
 * suffix, or a context larger than it (current or before a compaction) — then
 * the smallest standard size that fits. Without this a 1M session showed every
 * reading against 160K and sat at 100% before and after compacting.
 */
export function inferClaudeContextWindow({
  reported,
  configured,
  observedTokens = 0,
  model,
}: {
  reported?: number | null;
  configured: number;
  observedTokens?: number;
  model?: string | null;
}): number {
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) {
    return reported;
  }
  let window = configured;
  if (model && /\[1m\]/i.test(model)) {
    window = Math.max(window, 1_000_000);
  }
  if (observedTokens > window) {
    window = CLAUDE_CONTEXT_WINDOW_TIERS.find((size) => size >= observedTokens) ?? observedTokens;
  }
  return window;
}

/** The context one main-thread assistant row's request carried, or 0 for other rows. */
function readClaudeRowContextTokens(entry: AnyRecord | null | undefined): number {
  if (!entry || entry.isSidechain === true || entry.type !== 'assistant') {
    return 0;
  }
  const usage = entry.message?.usage;
  if (!usage || typeof usage !== 'object') {
    return 0;
  }
  return readUsageNumber(usage.input_tokens ?? usage.inputTokens)
    + readUsageNumber(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens)
    + readUsageNumber(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? usage.cacheCreationTokens)
    + readUsageNumber(usage.output_tokens ?? usage.outputTokens);
}

/** The size a compaction started from, or 0 when the row is not a compact boundary. */
export function readClaudeCompactionPreTokens(entry: AnyRecord | null | undefined): number {
  if (!entry || entry.type !== 'system' || entry.subtype !== 'compact_boundary') {
    return 0;
  }
  const metadata = entry.compact_metadata ?? entry.compactMetadata;
  return metadata && typeof metadata === 'object'
    ? readUsageNumber(metadata.pre_tokens ?? metadata.preTokens)
    : 0;
}

/** The largest context the given transcript rows show the session holding. */
function findLargestClaudeContext(entries: AnyRecord[]): number {
  let largest = 0;
  for (const entry of entries) {
    largest = Math.max(largest, readClaudeRowContextTokens(entry), readClaudeCompactionPreTokens(entry));
  }
  return largest;
}

function readUsageNumber(value: unknown): number {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

/**
 * Latest context-window usage from a Claude transcript's already-parsed rows.
 *
 * Exported because the session-messages reader hands the same usage back on
 * every history page. Without that,
 * a Claude session's counter only moved when the session was reselected, and
 * the store's "this provider reports no usage" path overwrote it with zero.
 *
 * Reads the newest assistant turn only: `input_tokens + cache_read +
 * cache_creation` is that one request's whole prompt, i.e. what the context
 * window currently holds. Summing turns would count the same cached prefix
 * once per turn.
 *
 * The total is the window the SDK reported for the session when there is one,
 * and otherwise the CONTEXT_WINDOW setting, raised when the session is known to
 * need more (see `inferClaudeContextWindow`).
 */
export function summarizeClaudeTokenUsage(
  entries: AnyRecord[],
  configuredContextWindow: string | undefined = process.env.CONTEXT_WINDOW,
  reportedContextWindow?: number,
  options: { providerSessionId?: string | null; model?: string | null } = {},
): TokenUsageResult {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    // A subagent's turns report the subagent's context window, not this
    // conversation's; reading one makes the counter drop to the subagent's
    // number and bounce back on the next main-thread turn.
    if (entry?.isSidechain === true) {
      continue;
    }

    const usage = entry?.type === 'assistant' ? entry.message?.usage : null;
    if (!usage) {
      continue;
    }

    const directInputTokens = readUsageNumber(usage.input_tokens ?? usage.inputTokens);
    const rowCacheReadTokens = readUsageNumber(
      usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens,
    );
    const rowCacheCreationTokens = readUsageNumber(
      usage.cache_creation_input_tokens
        ?? usage.cacheCreationInputTokens
        ?? usage.cacheCreationTokens,
    );
    const rowInputTokens = directInputTokens + rowCacheReadTokens + rowCacheCreationTokens;
    const rowOutputTokens = readUsageNumber(usage.output_tokens ?? usage.outputTokens);

    // `<synthetic>` rows — interrupts, API errors, "No response requested" —
    // are written with an all-zero usage block rather than none at all. They
    // never carried a prompt, so treating one as the newest turn zeroed a
    // counter that a live event had just set correctly.
    if (rowInputTokens === 0 && rowOutputTokens === 0) {
      continue;
    }

    cacheReadTokens = rowCacheReadTokens;
    cacheCreationTokens = rowCacheCreationTokens;
    inputTokens = rowInputTokens;
    outputTokens = rowOutputTokens;
    break;
  }

  const largestContext = findLargestClaudeContext(entries);
  noteObservedClaudeContextTokens(options.providerSessionId, largestContext);
  const contextWindow = inferClaudeContextWindow({
    reported: reportedContextWindow,
    configured: readConfiguredClaudeContextWindow(configuredContextWindow),
    observedTokens: Math.max(largestContext, getObservedClaudeContextTokens(options.providerSessionId)),
    model: options.model,
  });
  const cacheTokens = cacheReadTokens + cacheCreationTokens;

  return {
    used: inputTokens + outputTokens,
    total: contextWindow,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens,
    breakdown: { input: inputTokens, output: outputTokens },
  };
}

function parseClaudeUsageEntries(fileContent: string): AnyRecord[] {
  const entries: AnyRecord[] = [];
  for (const line of fileContent.trim().split('\n')) {
    try {
      entries.push(JSON.parse(line) as AnyRecord);
    } catch {
      // Skip malformed lines without discarding usage from earlier messages.
    }
  }
  return entries;
}

function claudeEntriesHaveUsage(entries: AnyRecord[]): boolean {
  return entries.some((entry) => entry?.type === 'assistant' && entry.message?.usage);
}


/**
 * Creates the provider token-usage service used by the provider routes. The
 * provider test suite supplies isolated filesystem and session dependencies so
 * every calculator can be exercised without touching a developer's real data.
 */
export function createProviderTokenUsageService(
  dependencyOverrides: Partial<ProviderTokenUsageServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  return {
    /**
     * Resolves all provider-specific storage details from one app-facing
     * session id, then returns the latest usage snapshot for that provider.
     */
    async getSessionTokenUsage(sessionId: string): Promise<TokenUsageResult> {
      const session = dependencies.getSessionById(sessionId);
      if (!session) {
        throw new AppError(`Session "${sessionId}" was not found.`, {
          code: 'SESSION_NOT_FOUND',
          statusCode: 404,
        });
      }

      // The fallback covers rows whose provider id was never recorded, and for
      // a session discovered from disk the app id *is* its provider id. That
      // stops being true the moment an edit rewinds the conversation off a
      // thread: until the replacement run announces its own id, the fallback
      // would resolve the retired transcript and report the discarded
      // conversation's usage against an empty one.
      if (
        !session.provider_session_id
        && dependencies.isProviderSessionSuperseded(sessionId, session.provider)
      ) {
        return {
          used: 0,
          inputTokens: 0,
          outputTokens: 0,
          breakdown: { input: 0, output: 0 },
        };
      }

      const providerSessionId = session.provider_session_id || sessionId;

      // Only Claude transcripts are read; a row left by a removed provider has no usage source.
      if (session.provider !== 'claude') {
        return {
          used: 0,
          total: 0,
          inputTokens: 0,
          outputTokens: 0,
          breakdown: { input: 0, output: 0 },
          unsupported: true,
          message: 'Token usage tracking is only available for Claude sessions',
        };
      }

      let sessionFilePath = session.jsonl_path;
      if (!sessionFilePath) {
        if (!session.project_path) {
          throw new AppError(`Session file for "${sessionId}" was not found.`, {
            code: 'SESSION_FILE_NOT_FOUND',
            statusCode: 404,
          });
        }

        const encodedProjectPath = session.project_path.replace(/[^a-zA-Z0-9-]/g, '-');
        const projectDirectory = path.join(
          dependencies.getHomeDirectory(),
          '.claude',
          'projects',
          encodedProjectPath,
        );
        sessionFilePath = path.join(projectDirectory, `${providerSessionId}.jsonl`);

        const relativePath = path.relative(path.resolve(projectDirectory), path.resolve(sessionFilePath));
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          throw new AppError('Resolved session path is invalid.', {
            code: 'INVALID_SESSION_PATH',
            statusCode: 400,
          });
        }
      }

      if (!dependencies.fileExists(sessionFilePath)) {
        throw new AppError(`Session file for "${sessionId}" was not found.`, {
          code: 'SESSION_FILE_NOT_FOUND',
          statusCode: 404,
        });
      }

      const tail = await dependencies.readTextFileTail(sessionFilePath, TOKEN_USAGE_TAIL_BYTES);
      let entries = parseClaudeUsageEntries(tail.content);
      if (!claudeEntriesHaveUsage(entries) && !tail.isComplete) {
        entries = parseClaudeUsageEntries(await dependencies.readTextFile(sessionFilePath));
      }
      return summarizeClaudeTokenUsage(
        entries,
        dependencies.getClaudeContextWindow(),
        dependencies.getReportedClaudeContextWindow(providerSessionId),
        { providerSessionId, model: session.model },
      );
    },
  };
}

/**
 * Used by the provider routes to serve token usage from only an app session id.
 */
export const providerTokenUsageService = createProviderTokenUsageService();
