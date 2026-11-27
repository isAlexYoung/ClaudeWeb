import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  fableRestriction,
  isFableModel,
  markPlanUnavailableModels,
  readClaudePlan,
} from '@/modules/providers/list/claude/claude-plan.service.js';

type Login = {
  credentials?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  settingsEnv?: Record<string, string>;
};

/** A home folder holding a Claude login shaped like the CLI writes it. */
async function withHome(login: Login, run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'claude-plan-'));
  try {
    await mkdir(path.join(home, '.claude'), { recursive: true });
    if (login.credentials !== null) {
      await writeFile(path.join(home, '.claude', '.credentials.json'), JSON.stringify({
        claudeAiOauth: { accessToken: 'secret', refreshToken: 'secret', expiresAt: Date.now() + 60_000, ...login.credentials },
      }));
    }
    if (login.account) {
      await writeFile(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: login.account }));
    }
    if (login.settingsEnv) {
      await writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: login.settingsEnv }));
    }
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('a Pro subscription cannot use Fable', async () => {
  // What Claude Code records for a Pro account.
  await withHome({
    credentials: { subscriptionType: 'pro', rateLimitTier: 'default_claude_ai' },
    account: { organizationType: 'claude_pro', seatTier: null },
  }, async (home) => {
    const plan = await readClaudePlan(home, {});
    assert.deepEqual(plan, { subscriptionType: 'pro', seatTier: null, organizationType: 'claude_pro' });
    assert.equal(fableRestriction(plan), 'subscription');
  });
});

test('a standard seat cannot use Fable; a premium seat and Max can', async () => {
  await withHome({ credentials: { subscriptionType: 'team' }, account: { organizationType: 'claude_team', seatTier: 'standard' } }, async (home) => {
    assert.equal(fableRestriction(await readClaudePlan(home, {})), 'seat');
  });
  await withHome({ credentials: { subscriptionType: 'enterprise' }, account: { seatTier: 'Standard' } }, async (home) => {
    assert.equal(fableRestriction(await readClaudePlan(home, {})), 'seat');
  });
  await withHome({ credentials: { subscriptionType: 'team' }, account: { seatTier: 'premium' } }, async (home) => {
    assert.equal(fableRestriction(await readClaudePlan(home, {})), null);
  });
  await withHome({ credentials: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } }, async (home) => {
    assert.equal(fableRestriction(await readClaudePlan(home, {})), null);
  });
});

test('nothing is restricted when the plan cannot be told', async () => {
  // Not signed in.
  await withHome({ credentials: null }, async (home) => {
    assert.equal(await readClaudePlan(home, {}), null);
  });
  // Signed in, but the login names no plan.
  await withHome({ credentials: {} }, async (home) => {
    assert.equal(await readClaudePlan(home, {}), null);
  });
  // Chats run on an API key or a long-lived token, in the environment or in settings.json.
  await withHome({ credentials: { subscriptionType: 'pro' } }, async (home) => {
    assert.equal(await readClaudePlan(home, { ANTHROPIC_API_KEY: 'sk-ant' }), null);
    assert.equal(await readClaudePlan(home, { CLAUDE_CODE_OAUTH_TOKEN: 'token' }), null);
    assert.equal(await readClaudePlan(home, { CLAUDE_CODE_USE_BEDROCK: '1' }), null);
  });
  await withHome({ credentials: { subscriptionType: 'pro' }, settingsEnv: { ANTHROPIC_API_KEY: 'sk-ant' } }, async (home) => {
    assert.equal(await readClaudePlan(home, {}), null);
  });
  assert.equal(fableRestriction(null), null);
});

test('every Fable model in the catalog is marked, by alias, id or name, and nothing else', () => {
  const catalog = [
    { value: 'default', label: 'Default (recommended)' },
    { value: 'opus', label: 'Opus 5.5' },
    { value: 'fable', label: 'Fable 5.2' },
    { value: 'claude-fable-5-1', label: 'Fable 5.1' },
    { value: 'best', label: 'Fable' },
    { value: 'haiku', label: 'Haiku 5.5' },
  ];
  assert.equal(isFableModel({ value: 'claude-fable-5', label: 'Claude' }), true);
  const pro = { subscriptionType: 'pro', seatTier: null, organizationType: 'claude_pro' };
  assert.deepEqual(
    markPlanUnavailableModels(catalog, pro).map((option) => [option.value, option.unavailable ?? null]),
    [['default', null], ['opus', null], ['fable', 'subscription'], ['claude-fable-5-1', 'subscription'], ['best', 'subscription'], ['haiku', null]],
  );
  // An unrestricted plan leaves the catalog as it was.
  assert.equal(markPlanUnavailableModels(catalog, { subscriptionType: 'max', seatTier: null, organizationType: null }), catalog);
  assert.equal(markPlanUnavailableModels(catalog, null), catalog);
});
