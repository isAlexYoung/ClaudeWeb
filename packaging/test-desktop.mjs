// Real graphical lifecycle check, run as claudeweb against a built app directory:
// node packaging/test-desktop.mjs /path/to/app
// Uses an isolated HOME/profile; never signs in or touches the user's real profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const app = path.resolve(process.argv[2] ?? '/opt/claudeweb/current/app');
const require = createRequire(path.join(app, 'package.json'));
const { WebSocket, WebSocketServer } = require('ws');
const { createGraphicalSessionService } = await import(pathToFileURL(path.join(app, 'dist-server/server/modules/graphical-session/index.js')));
const home = fs.mkdtempSync(path.join(os.homedir(), '.cache/desktop-acceptance-'));
const desktop = createGraphicalSessionService({ homeDirectory: home, application: 'claude-desktop' });
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const chromium = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
  .flatMap((name) => ['chrome-linux64', 'chrome-linux'].map((dir) => path.join(cache, name, dir, 'chrome'))).find(fs.existsSync);
const browser = createGraphicalSessionService({ homeDirectory: home, chromiumPath: chromium });
const server = createServer();
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, request) => {
  const url = new URL(request.url, 'http://localhost');
  (url.pathname === '/desktop' ? desktop : browser).relay(ws, url);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const sid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 24);
const ids = { desktop: sid(), browser: sid() };

async function connect(kind, id) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/${kind}?sid=${id}&w=1024&h=720`);
  let bytes = Buffer.alloc(0);
  let ended = '';
  ws.on('message', (data) => { bytes = Buffer.concat([bytes, data]); });
  ws.on('close', (code, reason) => { ended = `${code} ${reason}`; });
  const read = async (n) => {
    const deadline = Date.now() + 100000;
    while (bytes.length < n) {
      if (ended) throw new Error(`Display closed: ${ended}`);
      if (Date.now() > deadline) throw new Error('Display timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const value = bytes.subarray(0, n); bytes = bytes.subarray(n); return value;
  };
  assert.match((await read(12)).toString(), /^RFB /);
  ws.send(Buffer.from('RFB 003.008\n'));
  const types = await read((await read(1))[0]);
  assert.ok(types.includes(1)); ws.send(Buffer.from([1]));
  assert.equal((await read(4)).readUInt32BE(0), 0);
  ws.send(Buffer.from([0]));
  const info = await read(24); await read(info.readUInt32BE(20));
  const width = info.readUInt16BE(0), height = info.readUInt16BE(2);
  ws.send(Buffer.from([2, 0, 0, 1, 0, 0, 0, 0])); // Raw encoding.
  const request = Buffer.from([3, 0, 0, 0, 0, 0, width >> 8, width & 255, height >> 8, height & 255]);
  ws.send(request);
  assert.equal((await read(4))[0], 0, 'framebuffer update received');
  const rect = await read(12);
  assert.equal(rect.readInt32BE(8), 0);
  await read(rect.readUInt16BE(4) * rect.readUInt16BE(6) * (info[4] / 8));
  return ws;
}

function ownedGraphicalProcesses() {
  const found = [];
  for (const name of fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    try {
      const env = fs.readFileSync(`/proc/${name}/environ`).toString();
      if (env.includes(`HOME=${home}\0`)) found.push(Number(name));
    } catch { /* Other users and exited processes. */ }
  }
  return found;
}

try {
  assert.ok(await desktop.available(), 'official Desktop and display/keyring dependencies installed');
  const interrupted = new WebSocket(`ws://127.0.0.1:${port}/desktop?sid=${ids.desktop}&w=1024&h=720`);
  interrupted.on('error', () => {});
  const startupDeadline = Date.now() + 20000;
  while (true) {
    const status = JSON.parse((await desktop.status(ids.desktop)).body);
    if (['browser_spawned', 'browser_visible', 'websocket_ready'].includes(status.stage)) break;
    assert.ok(Date.now() < startupDeadline, 'Desktop reaches application startup');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await desktop.end(ids.desktop);
  interrupted.terminate();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.deepEqual(ownedGraphicalProcesses(), [], 'closing during startup cancels window waiters and all private processes');
  console.log('PASS close during startup cancels helpers and leaves no graphical processes');
  ids.desktop = sid();
  const [one, two] = await Promise.all([connect('desktop', ids.desktop), connect('browser', ids.browser)]);
  assert.equal(JSON.parse((await desktop.status(ids.desktop)).body).state, 'open');
  console.log('PASS official ClaudeDesktop renders an RFB frame as the ordinary user');
  const profile = path.join(home, '.config/claudeweb-desktop');
  const secret = fs.readFileSync(path.join(profile, '.keyring-secret'));
  const marker = path.join(profile, 'Claude/acceptance-kept.json');
  fs.writeFileSync(marker, 'persistent');
  const codeCache = path.join(profile, 'Claude/Code Cache/acceptance');
  fs.mkdirSync(codeCache, { recursive: true });
  for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(codeCache, `${i}`), 'cache');
  const before = ownedGraphicalProcesses();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.ok(before.length > 0);
  assert.ok(before.every((pid) => fs.existsSync(`/proc/${pid}`)), 'parking the connected panel retains its processes');
  console.log('PASS minimized/parked connection retains the same Desktop processes');
  await desktop.end(ids.desktop);
  assert.equal(fs.existsSync(codeCache), false);
  assert.equal(fs.existsSync(path.join(home, '.cache/claudeweb-desktop-runtime')), false);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'persistent');
  assert.deepEqual(fs.readFileSync(path.join(profile, '.keyring-secret')), secret);
  assert.equal(JSON.parse((await browser.status(ids.browser)).body).state, 'open');
  assert.equal(two.readyState, WebSocket.OPEN);
  console.log('PASS close reclaims 200 cache files/runtime inodes, preserves profile/keyring, and leaves browser alive');
  ids.desktop = sid();
  const reopened = await connect('desktop', ids.desktop);
  assert.deepEqual(fs.readFileSync(path.join(profile, '.keyring-secret')), secret);
  await desktop.end(ids.desktop);
  await browser.shutdown();
  one.terminate(); two.terminate(); reopened.terminate();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.deepEqual(ownedGraphicalProcesses(), [], 'all display, input method, keyring and application processes are gone');
  console.log('PASS Desktop reopens with the same keyring; explicit close leaves no graphical processes');
} finally {
  await desktop.end(ids.desktop).catch(() => {});
  await browser.end(ids.browser).catch(() => {});
  for (const client of wss.clients) client.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(home, { recursive: true, force: true });
}
