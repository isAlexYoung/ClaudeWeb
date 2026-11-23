import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import express from 'express';

import { createMediaTicketService, normalizePluginMediaPath } from '../media-ticket.service.js';
import { detectSafeMediaMime, isSafeCssGradient } from '../plugin-contract.js';
import { createPluginMediaRouter, createPublicAppearanceRouter } from '../plugins.routes.js';
import { createPluginsService } from '../plugins.service.js';
import { createPublicAppearanceService } from '../public-appearance.service.js';

// Isolate HOME / USERPROFILE before importing plugin-registry.service.js because it binds
// ~/.claude-code-ui/plugins at module load time.
const fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-plugin-v2-home-'));
const savedHome = process.env.HOME;
const savedUserProfile = process.env.USERPROFILE;
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;

const {
  checkPluginCompatibility,
  getPluginDir,
  installPluginFromGit,
  shouldSkipBuild,
  updatePluginFromGit,
  validateManifest,
  verifyPluginArtifacts,
} = await import('../plugin-registry.service.js');

process.on('exit', () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  fs.rmSync(fixtureHome, { recursive: true, force: true });
});

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
]);

function sha256Integrity(content: string | Buffer): string {
  return `sha256-${crypto.createHash('sha256').update(content).digest('hex')}`;
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('manifest v2 validation tolerates unknown future fields and validates slots & paths', () => {
  const valid = validateManifest({
    manifestVersion: 2,
    minPluginApi: 2,
    requiredCapabilities: ['slots:background', 'media-ticket'],
    name: 'wallpaper-demo',
    displayName: 'Wallpaper Demo',
    version: '1.0.0',
    type: 'module',
    slot: 'background',
    slots: ['background', 'settings'],
    panel: { title: 'Wallpaper', mode: 'drawer', width: 440 },
    publicAppearance: true,
    entry: 'dist/index.js',
    server: 'dist/server.cjs',
    futureUnknownField: { nested: true },
  });
  assert.equal(valid.valid, true);

  const badSlot = validateManifest({
    name: 'bad-slot',
    displayName: 'Bad Slot',
    entry: 'index.js',
    slots: ['background', 'nonexistent'],
  });
  assert.equal(badSlot.valid, false);

  const traversal = validateManifest({
    name: 'bad-path',
    displayName: 'Bad Path',
    entry: '../escape.js',
  });
  assert.equal(traversal.valid, false);

  const autoBuild = validateManifest({
    name: 'auto-build',
    displayName: 'Auto Build',
    entry: 'dist/index.js',
    build: { mode: 'auto' },
  });
  assert.equal(autoBuild.valid, true);

  const prebuiltMode = validateManifest({
    name: 'prebuilt-build',
    displayName: 'Prebuilt Build',
    entry: 'dist/index.js',
    build: { mode: 'prebuilt' },
  });
  assert.equal(prebuiltMode.valid, true);

  const invalidSourceMode = validateManifest({
    name: 'invalid-source-mode',
    displayName: 'Invalid Source Mode',
    entry: 'dist/index.js',
    build: { mode: 'source' },
  });
  assert.equal(invalidSourceMode.valid, false);
});

test('compatibility checks enforce minPluginApi and requiredCapabilities', () => {
  assert.equal(checkPluginCompatibility({ minPluginApi: 2, requiredCapabilities: ['media-ticket'] }).compatible, true);

  const newerApi = checkPluginCompatibility({ minPluginApi: 99 });
  assert.equal(newerApi.compatible, false);
  assert.match(String(newerApi.reason), /API v99/);

  const missingCap = checkPluginCompatibility({ requiredCapabilities: ['future-sandbox-v9'] });
  assert.equal(missingCap.compatible, false);
  assert.match(String(missingCap.reason), /future-sandbox-v9/);
});

test('prebuilt artifact verification skips build only when artifacts exist and pass SHA-256 integrity', () => {
  const dir = makeTempDir('cw-prebuilt-');
  try {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    const entryCode = 'export function mount() {}\n';
    const serverCode = 'console.log("ok");\n';
    fs.writeFileSync(path.join(dir, 'dist/index.js'), entryCode);
    fs.writeFileSync(path.join(dir, 'dist/server.cjs'), serverCode);

    const manifest = {
      entry: 'dist/index.js',
      server: 'dist/server.cjs',
      build: {
        mode: 'prebuilt',
        integrity: {
          'dist/index.js': sha256Integrity(entryCode),
          'dist/server.cjs': sha256Integrity(serverCode),
        },
      },
    };

    assert.equal(shouldSkipBuild(dir, manifest), true);
    assert.doesNotThrow(() => verifyPluginArtifacts(dir, manifest));

    // Tamper with dist/index.js -> integrity check must throw PLUGIN_INTEGRITY_MISMATCH
    fs.writeFileSync(path.join(dir, 'dist/index.js'), 'export function mount() { alert(1); }\n');
    assert.throws(
      () => verifyPluginArtifacts(dir, manifest),
      (err: any) => err?.code === 'PLUGIN_INTEGRITY_MISMATCH',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectSafeMediaMime sniffs safe binary headers and rejects SVG/HTML/text', () => {
  assert.equal(detectSafeMediaMime(PNG_HEADER), 'image/png');
  assert.equal(detectSafeMediaMime(MP4_HEADER), 'video/mp4');
  assert.equal(detectSafeMediaMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectSafeMediaMime(Buffer.from('<!doctype html><script>alert(1)</script>')), null);
  assert.equal(isSafeCssGradient('linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'), true);
  assert.equal(isSafeCssGradient('url(javascript:alert(1))'), false);
});

test('media ticket service binds tickets to plugin, normalized path and active login session', () => {
  let alive = true;
  const tickets = createMediaTicketService({
    sessionAlive: (sid) => alive && sid === 'sess-1',
  });

  assert.equal(normalizePluginMediaPath('media/bg.mp4'), '/media/bg.mp4');
  assert.throws(() => normalizePluginMediaPath('/../secret'), /not allowed/i);

  const minted = tickets.createTicket({
    pluginName: 'wallpaper',
    path: '/media/bg.mp4',
    sessionId: 'sess-1',
    ttlMs: 60_000,
  });
  assert.ok(minted.ticketId.length >= 32);

  const resolved = tickets.resolveTicket('wallpaper', minted.ticketId);
  assert.equal(resolved?.normalizedPath, '/media/bg.mp4');
  // Wrong plugin name cannot redeem another plugin's ticket
  assert.equal(tickets.resolveTicket('other-plugin', minted.ticketId), null);

  // Logout immediately invalidates ticket
  alive = false;
  assert.equal(tickets.resolveTicket('wallpaper', minted.ticketId), null);

  // Re-mint and verify plugin-wide revocation
  alive = true;
  const minted2 = tickets.createTicket({
    pluginName: 'wallpaper',
    path: '/media/bg2.png',
    sessionId: 'sess-1',
  });
  tickets.revokeForPlugin('wallpaper');
  assert.equal(tickets.resolveTicket('wallpaper', minted2.ticketId), null);
});

test('public appearance service validates media, supports per-theme slots, strips ownerPlugin and GCs unused files', () => {
  const dir = makeTempDir('cw-pubapp-');
  try {
    const svc = createPublicAppearanceService({ rootDir: dir });
    assert.equal(svc.getPublicState().enabled, false);

    // Rejects unsafe SVG payload
    assert.throws(
      () => svc.storeMediaBuffer(Buffer.from('<svg><script>alert(1)</script></svg>')),
      /Unsupported or unsafe media/i,
    );

    const img1 = svc.storeMediaBuffer(PNG_HEADER);
    const img2 = svc.storeMediaBuffer(Buffer.concat([PNG_HEADER, Buffer.from('extra-bytes')]));
    assert.equal(img1.mimeType, 'image/png');

    const published = svc.publish('wallpaper', {
      enabled: true,
      mode: 'per-theme',
      slots: {
        warm: { mediaType: 'image', mediaHash: img1.hash, fit: 'cover', blurPx: 4 },
        dark: { mediaType: 'gradient', cssGradient: 'linear-gradient(135deg, #111 0%, #222 100%)' },
      },
    });
    assert.equal(published.enabled, true);
    assert.equal(published.mode, 'per-theme');
    assert.equal('ownerPlugin' in (published as Record<string, unknown>), false);

    // img2 was never referenced in slots so GC should have removed it; img1 stays
    assert.ok(svc.resolvePublicMedia(img1.hash));
    assert.equal(svc.resolvePublicMedia(img2.hash), null);

    // Non-owner plugin cannot clear another plugin's login appearance
    svc.clear('other-plugin');
    assert.equal(svc.getPublicState().enabled, true);

    // Owner plugin clearing disables login appearance and GCs media
    svc.clear('wallpaper');
    assert.equal(svc.getPublicState().enabled, false);
    assert.equal(svc.resolvePublicMedia(img1.hash), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('background slot arbitration enforces single-active owner and revokes state on disable/takeover', async () => {
  let config: Record<string, any> = {
    'wp-a': { enabled: true },
    'wp-b': { enabled: false },
    _host: { activeBackgroundPlugin: 'wp-a', overlayOrder: [] },
  };
  const revoked: string[] = [];
  const clearedPublic: string[] = [];

  const service = createPluginsService({
    scanPlugins: () => [
      {
        name: 'wp-a', dirName: 'wp-a', slot: 'background', slots: ['background', 'settings'],
        enabled: Boolean(config['wp-a']?.enabled), server: null, compatible: true,
      },
      {
        name: 'wp-b', dirName: 'wp-b', slot: 'background', slots: ['background', 'settings'],
        enabled: Boolean(config['wp-b']?.enabled), server: null, compatible: true,
      },
    ],
    readConfig: () => config,
    saveConfig: (next) => { config = next; },
    getPluginDirectory: (name) => `/plugins/${name}`,
    resolveAsset: () => null,
    assetIsFile: () => false,
    contentType: () => 'text/plain',
    install: async () => ({ name: 'wp-a', dirName: 'wp-a' }),
    update: async () => ({ name: 'wp-a', dirName: 'wp-a' }),
    uninstall: async () => undefined,
    startServer: async () => 4000,
    stopServer: async () => undefined,
    getServerPort: () => undefined,
    isServerRunning: () => false,
    logError: () => undefined,
    revokeMediaTickets: (name) => { revoked.push(name); return 0; },
    clearPublicAppearance: (name) => { if (name) clearedPublic.push(name); return true; },
  });

  // Enabling wp-b without takeoverBackground must fail with 409 BACKGROUND_SLOT_OCCUPIED
  await assert.rejects(
    service.setEnabled('wp-b', true),
    (err: any) => err?.code === 'BACKGROUND_SLOT_OCCUPIED' && err?.statusCode === 409 && err?.details?.activePlugin === 'wp-a',
  );

  // Explicit takeover transfers ownership and clears wp-a's public login appearance
  const taken = await service.setEnabled('wp-b', true, { takeoverBackground: true });
  assert.equal(taken.activeBackgroundPlugin, 'wp-b');
  assert.deepEqual(clearedPublic, ['wp-a']);

  // Disabling wp-b revokes tickets, clears public appearance, and vacates active background
  const disabled = await service.setEnabled('wp-b', false);
  assert.equal(disabled.activeBackgroundPlugin, null);
  assert.deepEqual(revoked, ['wp-b']);
  assert.deepEqual(clearedPublic, ['wp-a', 'wp-b']);
});

test('public appearance and ticketed media routers support Range/206, ETag/304, no-store and block unsafe MIME', async () => {
  const dir = makeTempDir('cw-routes-');
  const videoBytes = Buffer.concat([MP4_HEADER, Buffer.from('0123456789abcdef')]);
  const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

  let pluginBackend: http.Server | null = null;
  let hostServer: http.Server | null = null;

  try {
    // Fake plugin backend serving one valid MP4 (with Range support) and one unsafe SVG
    pluginBackend = http.createServer((req, res) => {
      if (req.url === '/media/safe.mp4') {
        const range = req.headers.range;
        if (range === 'bytes=0-7') {
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes 0-7/${videoBytes.length}`,
            'Content-Length': '8',
          });
          res.end(videoBytes.subarray(0, 8));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(videoBytes.length) });
        res.end(videoBytes);
        return;
      }
      if (req.url === '/media/evil.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(svgBytes);
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => pluginBackend!.listen(0, '127.0.0.1', resolve));
    const backendPort = (pluginBackend.address() as { port: number }).port;

    let sessionValid = true;
    const tickets = createMediaTicketService({ sessionAlive: () => sessionValid });
    const pubApp = createPublicAppearanceService({ rootDir: dir });
    const stored = pubApp.storeMediaBuffer(videoBytes);
    pubApp.publish('wp', {
      enabled: true,
      mode: 'single',
      slots: { default: { mediaType: 'video', mediaHash: stored.hash, fit: 'cover' } },
    });

    const pluginsService = createPluginsService({
      scanPlugins: () => [{ name: 'wp', dirName: 'wp', enabled: true, server: 'server.cjs', compatible: true }],
      readConfig: () => ({ wp: { enabled: true } }),
      saveConfig: () => undefined,
      getPluginDirectory: () => dir,
      resolveAsset: () => null,
      assetIsFile: () => false,
      contentType: () => 'text/plain',
      install: async () => ({ name: 'wp', dirName: 'wp' }),
      update: async () => ({ name: 'wp', dirName: 'wp' }),
      uninstall: async () => undefined,
      startServer: async () => backendPort,
      stopServer: async () => undefined,
      getServerPort: () => backendPort,
      isServerRunning: () => true,
      logError: () => undefined,
      createMediaTicket: (p) => tickets.createTicket(p),
      resolveMediaTicket: (n, id) => tickets.resolveTicket(n, id),
    });

    const app = express();
    app.use('/api/public/appearance', createPublicAppearanceRouter(pubApp));
    app.use('/api/plugins', createPluginMediaRouter(pluginsService));
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err?.statusCode || 500).json({ error: err?.message || 'Error', code: err?.code });
    });

    hostServer = await new Promise<http.Server>((resolve) => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const hostPort = (hostServer.address() as { port: number }).port;

    // 1. Public appearance state is strictly no-store
    const stateRes = await fetch(`http://127.0.0.1:${hostPort}/api/public/appearance`);
    assert.equal(stateRes.status, 200);
    assert.match(stateRes.headers.get('cache-control') || '', /no-store/);
    const stateJson = (await stateRes.json()) as { enabled: boolean };
    assert.equal(stateJson.enabled, true);

    // 2. Public appearance media supports Range/206 and ETag/304
    const rangeRes = await fetch(`http://127.0.0.1:${hostPort}/api/public/appearance/media/${stored.hash}`, {
      headers: { Range: 'bytes=0-7' },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await rangeRes.arrayBuffer()).byteLength, 8);
    const etag = rangeRes.headers.get('etag');
    assert.ok(etag);
    const cachedRes = await fetch(`http://127.0.0.1:${hostPort}/api/public/appearance/media/${stored.hash}`, {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(cachedRes.status, 304);

    // 3. Media ticket streams Range/206 from plugin backend
    const goodTicket = await pluginsService.createMediaTicket('wp', '/media/safe.mp4', 'sess-1');
    const mediaRes = await fetch(`http://127.0.0.1:${hostPort}${goodTicket.url}`, {
      headers: { Range: 'bytes=0-7' },
    });
    assert.equal(mediaRes.status, 206);
    assert.equal(mediaRes.headers.get('x-content-type-options'), 'nosniff');
    assert.match(mediaRes.headers.get('cache-control') || '', /no-store/);
    assert.equal((await mediaRes.arrayBuffer()).byteLength, 8);

    // 4. Media ticket rejects SVG upstream with 415
    const evilTicket = await pluginsService.createMediaTicket('wp', '/media/evil.svg', 'sess-1');
    const evilRes = await fetch(`http://127.0.0.1:${hostPort}${evilTicket.url}`);
    assert.equal(evilRes.status, 415);

    // 5. After logout, existing ticket is rejected with 401
    sessionValid = false;
    const afterLogout = await fetch(`http://127.0.0.1:${hostPort}${goodTicket.url}`);
    assert.equal(afterLogout.status, 401);
  } finally {
    if (hostServer) {
      hostServer.closeAllConnections();
      await new Promise<void>((resolve) => hostServer!.close(() => resolve()));
    }
    if (pluginBackend) {
      pluginBackend.closeAllConnections();
      await new Promise<void>((resolve) => pluginBackend!.close(() => resolve()));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('updatePluginFromGit stages updates in a temp dir and keeps previous version intact on build/integrity failure', async () => {
  const sandbox = makeTempDir('cw-atomic-update-');
  const repoDir = path.join(sandbox, 'remote-repo');
  fs.mkdirSync(repoDir, { recursive: true });

  const git = (args: string[]) => execFileSync('git', args, {
    cwd: repoDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  });

  try {
    // Create a local Git repo with a valid prebuilt v1.0.0 plugin
    git(['init']);
    fs.writeFileSync(path.join(repoDir, '.gitattributes'), 'dist/** -text\n');
    fs.mkdirSync(path.join(repoDir, 'dist'), { recursive: true });
    const v1Code = 'export const version = "1.0.0";\n';
    fs.writeFileSync(path.join(repoDir, 'dist/index.js'), v1Code);
    fs.writeFileSync(path.join(repoDir, 'manifest.json'), JSON.stringify({
      manifestVersion: 2,
      minPluginApi: 2,
      name: 'atomic-demo',
      displayName: 'Atomic Demo',
      version: '1.0.0',
      type: 'module',
      slot: 'tab',
      slots: ['tab'],
      entry: 'dist/index.js',
      build: {
        mode: 'prebuilt',
        integrity: { 'dist/index.js': sha256Integrity(v1Code) },
      },
    }, null, 2));
    git(['add', '.']);
    git(['commit', '-m', 'v1.0.0']);

    // Install v1.0.0 via file:// URL (cross-platform on Windows & Linux)
    const installed = (await installPluginFromGit(pathToFileURL(repoDir).href)) as { name: string };
    assert.equal(installed.name, 'atomic-demo');

    const pluginsRoot = path.join(fixtureHome, '.claude-code-ui', 'plugins');
    const liveDir = getPluginDir('atomic-demo');
    assert.ok(liveDir);
    assert.equal(JSON.parse(fs.readFileSync(path.join(liveDir, 'manifest.json'), 'utf8')).version, '1.0.0');

    // Push a broken v2.0.0 commit with mismatched SHA-256 integrity
    fs.writeFileSync(path.join(repoDir, 'dist/index.js'), 'export const version = "2.0.0";\n');
    fs.writeFileSync(path.join(repoDir, 'manifest.json'), JSON.stringify({
      manifestVersion: 2,
      minPluginApi: 2,
      name: 'atomic-demo',
      displayName: 'Atomic Demo',
      version: '2.0.0',
      type: 'module',
      slot: 'tab',
      slots: ['tab'],
      entry: 'dist/index.js',
      build: {
        mode: 'prebuilt',
        integrity: { 'dist/index.js': 'sha256-0000000000000000000000000000000000000000000000000000000000000000' },
      },
    }, null, 2));
    git(['add', '.']);
    git(['commit', '-m', 'broken v2.0.0']);

    await assert.rejects(updatePluginFromGit('atomic-demo'), /integrity/i);

    // Live installation must STILL be untouched v1.0.0 and no .tmp-* staging dirs left behind
    assert.equal(JSON.parse(fs.readFileSync(path.join(liveDir, 'manifest.json'), 'utf8')).version, '1.0.0');
    assert.equal(fs.readFileSync(path.join(liveDir, 'dist/index.js'), 'utf8'), v1Code);
    const entries = fs.readdirSync(pluginsRoot);
    assert.equal(entries.some((entry) => entry.startsWith('.tmp-')), false);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
