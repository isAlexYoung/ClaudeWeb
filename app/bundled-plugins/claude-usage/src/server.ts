import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseCredentials, LiveCache, LiveResult, Credentials } from './live.js';
import { PlanNameCache } from './profile.js';
import { aggregate } from './history.js';
import { loadSessions } from './transcripts.js';
import { aggregateDashboard } from './dashboard.js';

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

function oauthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'Content-Type': 'application/json',
  };
}

// ── /live ──────────────────────────────────────────────────────────────

/** Local, no-network checks — never throttled, so a fresh login shows up immediately. */
function readCredentials(): Credentials {
  let credsJson: unknown;
  try {
    credsJson = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, '.credentials.json'), 'utf-8'));
  } catch {
    throw Object.assign(new Error('No Claude Code credentials found — sign in with the claude CLI first.'), { status: 404 });
  }
  const creds = parseCredentials(credsJson, Date.now());
  if (!creds) throw Object.assign(new Error('Unrecognized credentials file format.'), { status: 500 });
  if (creds.expired) {
    throw Object.assign(new Error('OAuth token expired — run claude to refresh it, then retry.'), { status: 401 });
  }
  return creds;
}

// The endpoint is shared with Claude Code's own /usage screen and rate-limits
// after only a few calls, so LiveCache polls it at most every 5 minutes and
// backs off on 429 (see live.ts).
const liveCache = new LiveCache(async () => {
  const creds = readCredentials();
  const res = await fetch(USAGE_URL, {
    headers: oauthHeaders(creds.accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  return {
    status: res.status,
    retryAfter: res.headers.get('retry-after'),
    body: res.ok ? await res.json() : null,
    plan: creds.plan,
    tier: creds.tier,
  };
});

// The plan's display name ("Ultra") is not in the credentials file; see profile.ts.
const planNames = new PlanNameCache(async (accessToken) => {
  const res = await fetch(PROFILE_URL, {
    headers: oauthHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Profile endpoint returned HTTP ${res.status}.`);
  return res.json();
});

async function getLive(force = false): Promise<LiveResult & { planName: string | null }> {
  const creds = readCredentials();
  const [live, planName] = await Promise.all([liveCache.get(force), planNames.get(creds.accessToken)]);
  return { ...live, planName };
}

// ── /history ───────────────────────────────────────────────────────────

async function getHistory(days: number) {
  return aggregate(await loadSessions(path.join(CLAUDE_DIR, 'projects')), days, Date.now());
}

// ── HTTP wiring ────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/dashboard') {
      const range = url.searchParams.get('range') ?? 'all';
      const timeZone = url.searchParams.get('timeZone') ?? 'UTC';
      if (!['all', '30', '7'].includes(range)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid history range' }));
        return;
      }
      try { new Intl.DateTimeFormat('en', { timeZone }); } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid time zone' }));
        return;
      }
      // Local history works independently of OAuth, including when /live returns 401.
      const sessions = await loadSessions(path.join(CLAUDE_DIR, 'projects'));
      res.end(JSON.stringify(aggregateDashboard(sessions, range as 'all' | '30' | '7', timeZone,
        url.searchParams.get('excludeProject') ?? '/home/claudeweb')));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/live') {
      res.end(JSON.stringify(await getLive(url.searchParams.get('refresh') === '1')));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/history') {
      const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
      res.end(JSON.stringify(await getHistory(days)));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err: any) {
    res.writeHead(typeof err?.status === 'number' ? err.status : 500);
    res.end(JSON.stringify({ error: err?.message ?? 'Internal error' }));
  }
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (addr && typeof addr !== 'string') {
    // Signal readiness to the host — this JSON line is required
    console.log(JSON.stringify({ ready: true, port: addr.port }));
  }
});
