import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ProviderModelOption, ProviderModelUnavailableReason } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

/**
 * The Claude subscription the CLI is signed in with, as Claude Code records
 * it: `subscriptionType` in `~/.claude/.credentials.json` ("pro", "max",
 * "team", ...) and the account's `seatTier` and `organizationType` in
 * `~/.claude.json`. Only these plan fields are read, never the tokens.
 */
export type ClaudePlan = {
  subscriptionType: string | null;
  seatTier: string | null;
  organizationType: string | null;
};

/**
 * Settings and environment that make the CLI use something other than the
 * `claude /login` subscription (an API key, a long-lived token, a cloud
 * provider). The subscription's model rules do not apply to those.
 */
const NON_SUBSCRIPTION_AUTH_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
];

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return readObjectRecord(JSON.parse(await readFile(filePath, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * The plan of the subscription chats run on, or null when it cannot be told:
 * not signed in with a subscription, or signed in some other way. Callers
 * treat null as "no restriction", so nothing usable is ever greyed out on a
 * guess.
 */
export async function readClaudePlan(
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaudePlan | null> {
  if (NON_SUBSCRIPTION_AUTH_VARIABLES.some((name) => env[name]?.trim())) {
    return null;
  }
  const settingsEnv = readObjectRecord((await readJson(path.join(home, '.claude', 'settings.json')))?.env) ?? {};
  if (NON_SUBSCRIPTION_AUTH_VARIABLES.some((name) => readOptionalString(settingsEnv[name]))) {
    return null;
  }

  const credentials = await readJson(path.join(home, '.claude', '.credentials.json'));
  const oauth = readObjectRecord(credentials?.claudeAiOauth);
  if (!readOptionalString(oauth?.accessToken) && !readOptionalString(oauth?.refreshToken)) {
    return null;
  }
  const account = readObjectRecord((await readJson(path.join(home, '.claude.json')))?.oauthAccount);
  const plan: ClaudePlan = {
    subscriptionType: readOptionalString(oauth?.subscriptionType)?.toLowerCase() ?? null,
    seatTier: readOptionalString(account?.seatTier)?.toLowerCase() ?? null,
    organizationType: readOptionalString(account?.organizationType)?.toLowerCase() ?? null,
  };
  return plan.subscriptionType || plan.seatTier || plan.organizationType ? plan : null;
}

/**
 * Why Fable cannot be used on this plan, or null when it can: Pro (and Free)
 * subscriptions do not include it, and neither does a standard seat of a Team
 * or Enterprise organization. Max, premium seats and anything the plan does
 * not settle are left alone.
 */
export function fableRestriction(plan: ClaudePlan | null): ProviderModelUnavailableReason | null {
  if (!plan) return null;
  if (plan.seatTier && /standard/.test(plan.seatTier)) return 'seat';
  if (plan.subscriptionType === 'pro' || plan.subscriptionType === 'free') return 'subscription';
  if (!plan.subscriptionType && (plan.organizationType === 'claude_pro' || plan.organizationType === 'claude_free')) {
    return 'subscription';
  }
  return null;
}

/** Fable models by alias (`fable`), id (`claude-fable-5-1`) or name ("Fable 5.2"). */
export function isFableModel(option: Pick<ProviderModelOption, 'value' | 'label'>): boolean {
  return /fable/i.test(option.value) || /fable/i.test(option.label ?? '');
}

/**
 * Marks the models this plan cannot use, so the model menus show them greyed
 * out instead of offering a model every request to which would fail.
 */
export function markPlanUnavailableModels(
  options: ProviderModelOption[],
  plan: ClaudePlan | null,
): ProviderModelOption[] {
  const reason = fableRestriction(plan);
  if (!reason) return options;
  return options.map((option) => (isFableModel(option) ? { ...option, unavailable: reason } : option));
}
