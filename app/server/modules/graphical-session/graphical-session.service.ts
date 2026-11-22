import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { WebSocket } from 'ws';

import { AppError } from '@/shared/utils.js';
import type { GraphicalReply } from '@/shared/types.js';
import { cleanDesktopCaches, startDesktopKeyring } from '@/modules/graphical-session/desktop-profile.service.js';

// Each tool gets one Chromium or official ClaudeDesktop instance. It runs as the
// service account on its own private X display (Xvnc, reachable only through a 0600
// unix socket and an Xauthority cookie), with Openbox for window management
// and Fcitx5 for Chinese input. The panel's WebSocket carries the raw RFB
// stream to noVNC. Opening the panel elsewhere takes the same tool over.

const SID = /^[a-f0-9]{24,64}$/;
const MIN_WIDTH = 640, MIN_HEIGHT = 480, MAX_WIDTH = 1600, MAX_HEIGHT = 1000;
const DETACHED_KEEP_MS = 10 * 60_000;
const ENDED_MEMORY = 32;
// Reserve before async X startup so browser and Desktop cannot choose the same display.
const reservedDisplays = new Set<number>();
const TEXT_MAX = 16384;
const IMAGE_MAX = 1000 * 1024;
const HIGH = 4 * 1024 * 1024;
const LOW = 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const REJECTED_TARGETS = new Set(['text/uri-list', 'x-special/gnome-copied-files', 'x-special/mate-copied-files',
  'x-special/nautilus-clipboard', 'application/x-kde-cutselection', 'application/x-qt-image', 'text/x-moz-url',
  'application/x-moz-file']);

const PROGRAMS = {
  xvnc: '/usr/bin/Xtigervnc',
  xauth: '/usr/bin/xauth',
  xprop: '/usr/bin/xprop',
  openbox: '/usr/bin/openbox',
  xdotool: '/usr/bin/xdotool',
  xclip: '/usr/bin/xclip',
  dbusDaemon: '/usr/bin/dbus-daemon',
  dbusSend: '/usr/bin/dbus-send',
  fcitx5: '/usr/bin/fcitx5',
};

const OPENBOX_CONFIG = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme><name>Clearlooks</name><titleLayout>NLIMC</titleLayout></theme>
  <desktops><number>1</number></desktops>
  <keyboard/>
  <applications><application class="*"><maximized>yes</maximized><decor>no</decor></application></applications>
</openbox_config>
`;

const FCITX_PROFILE = '[Groups/0]\nName=Default\nDefault Layout=us\nDefaultIM=pinyin\n\n[Groups/0/Items/0]\nName=keyboard-us\nLayout=\n\n'
  + '[Groups/0/Items/1]\nName=pinyin\nLayout=\n\n[GroupOrder]\n0=Default\n';
// Left or right Shift switches between English and Pinyin; no other hotkeys.
const FCITX_CONFIG = '[Hotkey]\nEnumerateWithTriggerKeys=False\n\n[Hotkey/TriggerKeys]\n0=Shift_L\n1=Shift_R\n\n'
  + '[Hotkey/AltTriggerKeys]\n\n[Hotkey/EnumerateForwardKeys]\n\n[Hotkey/EnumerateBackwardKeys]\n\n'
  + '[Hotkey/EnumerateGroupForwardKeys]\n\n[Hotkey/EnumerateGroupBackwardKeys]\n';

type SessionState = 'starting' | 'open' | 'detached' | 'stopping';

type Session = {
  sid: string;
  state: SessionState;
  stage: string;
  reason: string | null;
  display: string;
  env: NodeJS.ProcessEnv;
  vncSocket: string;
  children: ChildProcess[];
  chromium: ChildProcess | null;
  client: WebSocket | null;
  ready: Promise<void>;
  detachTimer: NodeJS.Timeout | null;
  stopping: Promise<void> | null;
  startupAbort: AbortController;
};

type Dependencies = {
  homeDirectory: string;
  /** Path to Chromium; when unset, the newest Playwright Chromium in the home cache. */
  chromiumPath?: string;
  /** Selects a separate display, profile and executable for Claude Desktop. */
  application?: 'browser' | 'claude-desktop';
};

function jsonReply(value: unknown, status = 200): GraphicalReply {
  return { status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) };
}

function requireSid(sid: unknown): string {
  if (typeof sid !== 'string' || !SID.test(sid)) {
    throw new AppError('A browser session id is required.', { code: 'INVALID_REQUEST', statusCode: 400 });
  }
  return sid;
}

function sendableCode(code: number): boolean {
  return code === 1000 || code === 1001 || code === 1008 || code === 1013 || (code >= 3000 && code <= 4999);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs a fixed program with a time limit; resolves with its exit code and output (bounded). */
function run(program: string, args: string[], env: NodeJS.ProcessEnv, options: { input?: Buffer; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {}) {
  return new Promise<{ code: number | null; stdout: Buffer; tooLarge: boolean }>((resolve) => {
    const child = execFile(program, args, {
      env, signal: options.signal, encoding: 'buffer', timeout: options.timeoutMs ?? 2000, maxBuffer: options.maxBytes ?? 65536, killSignal: 'SIGKILL',
    }, (error, stdout) => {
      const failure = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
      const tooLarge = failure?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      resolve({ code: failure ? (typeof failure.code === 'number' ? failure.code : -1) : 0, stdout: stdout ?? Buffer.alloc(0), tooLarge });
    });
    if (options.input) child.stdin?.end(options.input);
    else child.stdin?.end();
  });
}

function textProblem(text: string): string | null {
  if (!text) return 'EMPTY';
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if ((point < 0x20 && point !== 9 && point !== 10 && point !== 13) || (point >= 0x7f && point <= 0x9f)) return 'CONTROL_CHARACTERS';
    if (point >= 0xd800 && point <= 0xdfff) return 'INVALID_UTF8';
  }
  return null;
}

/**
 * Used by the browser and claude-desktop modules to run an isolated display and
 * answers the panel's status, clipboard, end and picture-connection requests.
 */
export function createGraphicalSessionService({ homeDirectory, chromiumPath, application = 'browser' }: Dependencies) {
  const desktop = application === 'claude-desktop';
  const applicationName = desktop ? 'ClaudeDesktop' : 'browser';
  const runDirectory = path.join(homeDirectory, '.cache', desktop ? 'claudeweb-desktop-runtime' : 'claudeweb-browser');
  const profileDirectory = path.join(homeDirectory, '.config', desktop ? 'claudeweb-desktop' : 'claudeweb-browser');
  let session: Session | null = null;
  // Why recent sessions ended, so a page that lost its connection can say so.
  const ended = new Map<string, string>();

  function remember(sid: string, reason: string) {
    ended.set(sid, reason);
    while (ended.size > ENDED_MEMORY) ended.delete(ended.keys().next().value as string);
  }

  function findChromium(): string | null {
    if (desktop) return fs.existsSync('/usr/bin/claude-desktop') ? '/usr/bin/claude-desktop' : null;
    if (chromiumPath) return fs.existsSync(chromiumPath) ? chromiumPath : null;
    const cache = path.join(homeDirectory, '.cache', 'ms-playwright');
    let names: string[];
    try { names = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)); } catch { return null; }
    names.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
    for (const name of names) {
      for (const folder of ['chrome-linux64', 'chrome-linux']) {
        const candidate = path.join(cache, name, folder, 'chrome');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  async function available(): Promise<boolean> {
    const required = [PROGRAMS.xvnc, PROGRAMS.xauth, PROGRAMS.xprop, PROGRAMS.openbox, PROGRAMS.xdotool, PROGRAMS.xclip,
      PROGRAMS.dbusDaemon, PROGRAMS.dbusSend];
    if (desktop) required.push('/usr/bin/gnome-keyring-daemon');
    return required.every((program) => fs.existsSync(program)) && findChromium() !== null;
  }

  function freeDisplay(): number {
    for (let display = 50; display < 100; display += 1) {
      if (!reservedDisplays.has(display) && !fs.existsSync(`/tmp/.X11-unix/X${display}`) && !fs.existsSync(`/tmp/.X${display}-lock`)) {
        reservedDisplays.add(display);
        return display;
      }
    }
    throw new Error('No free X display');
  }

  function startChild(current: Session, program: string, args: string[], logErrors = true): ChildProcess {
    // Own process group, so stopping it also stops what it started. The display
    // helpers' error output goes to the service log; Chromium's does not (it can
    // contain page addresses).
    if (current.state === 'stopping') throw new Error('Session was closed');
    const child = spawn(program, args, {
      env: current.env, cwd: homeDirectory, stdio: ['ignore', 'ignore', logErrors ? 'pipe' : 'ignore'], detached: true,
    });
    child.on('error', (error) => console.error(`[Browser] ${path.basename(program)}: ${error.message}`));
    if (logErrors) {
      // Only errors, a bounded number, and nothing while stopping (helpers
      // print their shutdown, which is expected).
      let logged = 0;
      child.stderr?.on('data', (chunk: Buffer) => {
        if (current.state === 'stopping') return;
        for (const line of chunk.toString('utf8').split('\n')) {
          if (logged < 20 && /\b(error|fatal|failed|cannot|could not)\b/i.test(line) && !/pinyin history/i.test(line)) {
            logged += 1;
            console.error(`[Browser] ${path.basename(program)}: ${line.trim().slice(0, 300)}`);
          }
        }
      });
    }
    current.children.push(child);
    return child;
  }

  async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number, failed: () => boolean) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      if (failed()) throw new Error('process exited');
      await wait(50);
    }
    throw new Error('timeout');
  }

  function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
    if (child.pid) {
      try { process.kill(-child.pid, signal); } catch { /* already gone */ }
    }
  }

  function stop(current: Session, reason: string): Promise<void> {
    if (current.stopping) return current.stopping;
    current.state = 'stopping';
    current.startupAbort.abort();
    current.reason = reason;
    remember(current.sid, reason);
    if (current.detachTimer) clearTimeout(current.detachTimer);
    current.stopping = (async () => {
      if (current.client?.readyState === WebSocket.OPEN) current.client.close(1000);
      // Signal the whole saved process group even when its original leader exited.
      if (current.chromium) {
        killGroup(current.chromium, 'SIGTERM');
        const deadline = Date.now() + 3000;
        while (current.chromium.exitCode === null && current.chromium.signalCode === null && Date.now() < deadline) await wait(50);
      }
      for (const child of [...current.children].reverse()) killGroup(child, 'SIGTERM');
      await wait(500);
      for (const child of current.children) killGroup(child, 'SIGKILL');
      await wait(200);
      try {
        if (desktop) cleanDesktopCaches(homeDirectory);
        fs.rmSync(runDirectory, { recursive: true, force: true });
      } catch (error) {
        console.error(`[Graphical] cleanup failed: ${error instanceof Error ? error.message : 'unknown'}`);
      } finally {
        reservedDisplays.delete(Number(current.display.slice(1)));
        if (session === current) session = null;
      }
    })();
    return current.stopping;
  }

  async function launch(current: Session, width: number, height: number) {
    const chromium = findChromium();
    if (!chromium) throw new Error('Chromium is not installed');
    fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(profileDirectory, 'fcitx5'), { recursive: true, mode: 0o700 });
    current.stage = 'gui_worker';
    for (const name of ['vnc.sock', 'bus', 'Xauthority']) fs.rmSync(path.join(runDirectory, name), { force: true });
    fs.writeFileSync(path.join(runDirectory, 'openbox.xml'), OPENBOX_CONFIG, { mode: 0o600 });
    fs.writeFileSync(path.join(runDirectory, 'dbus.conf'), `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig><type>session</type><listen>unix:path=${path.join(runDirectory, 'bus')}</listen><auth>EXTERNAL</auth>
<policy context="default"><allow own="*"/><allow send_destination="*"/><allow receive_sender="*"/></policy></busconfig>
`, { mode: 0o600 });
    const profileFile = path.join(profileDirectory, 'fcitx5', 'profile');
    if (!fs.existsSync(profileFile)) fs.writeFileSync(profileFile, FCITX_PROFILE, { mode: 0o600 });
    fs.writeFileSync(path.join(profileDirectory, 'fcitx5', 'config'), FCITX_CONFIG, { mode: 0o600 });

    const authority = path.join(runDirectory, 'Xauthority');
    current.env.XAUTHORITY = authority;
    const added = await run(PROGRAMS.xauth, ['-f', authority, 'add', current.display, '.', randomBytes(16).toString('hex')], current.env, { timeoutMs: 5000, signal: current.startupAbort.signal });
    if (added.code !== 0) throw new Error('xauth failed');
    fs.chmodSync(authority, 0o600);

    const xvnc = startChild(current, PROGRAMS.xvnc, [current.display, '-geometry', `${width}x${height}`, '-depth', '24',
      '-rfbport', '-1', '-rfbunixpath', current.vncSocket, '-rfbunixmode', '0600', '-SecurityTypes', 'None', '-localhost',
      '-nolisten', 'tcp', '-auth', authority, '-AcceptCutText=0', '-SendCutText=0', '-AcceptSetDesktopSize=1',
      '-FrameRate', '24', '-desktop', `ClaudeWeb ${applicationName}`]);
    // Ready when the picture socket exists and an X client can connect. The X
    // socket file is not required: where /tmp/.X11-unix is read-only (WSL),
    // Xvnc still listens on Linux's abstract socket of the same name.
    await waitFor(async () => fs.existsSync(current.vncSocket)
      && (await run(PROGRAMS.xprop, ['-root'], current.env, { timeoutMs: 1000, maxBytes: 1 << 20 })).code === 0,
    15_000, () => xvnc.exitCode !== null);
    current.stage = 'x11_ready';

    startChild(current, PROGRAMS.dbusDaemon, ['--nofork', `--config-file=${path.join(runDirectory, 'dbus.conf')}`]);
    await waitFor(() => fs.existsSync(path.join(runDirectory, 'bus')), 3000, () => false);
    current.stage = 'dbus_started';
    if (desktop) {
      await startDesktopKeyring(profileDirectory, current.env, (child) => current.children.push(child));
      if (current.state === 'stopping') throw new Error('Session was closed');
    }

    if (fs.existsSync(PROGRAMS.fcitx5)) {
      const ime = startChild(current, PROGRAMS.fcitx5, ['-D', '--replace']);
      try {
        await waitFor(async () => {
          const owner = await run(PROGRAMS.dbusSend, ['--session', '--print-reply', '--dest=org.freedesktop.DBus', '/',
            'org.freedesktop.DBus.NameHasOwner', 'string:org.fcitx.Fcitx5'], current.env);
          return owner.code === 0 && owner.stdout.includes('boolean true');
        }, 5000, () => ime.exitCode !== null);
      } catch {
        // Without the input method the browser still works, in English only.
        delete current.env.XMODIFIERS; delete current.env.GTK_IM_MODULE; delete current.env.QT_IM_MODULE;
      }
    }
    current.stage = 'ime_ready';

    const openbox = startChild(current, PROGRAMS.openbox, ['--config-file', path.join(runDirectory, 'openbox.xml')]);
    await waitFor(async () => {
      const wm = await run(PROGRAMS.xprop, ['-root', '_NET_SUPPORTING_WM_CHECK'], current.env, { timeoutMs: 1000 });
      return wm.code === 0 && wm.stdout.includes('window id #');
    }, 4000, () => openbox.exitCode !== null);
    current.stage = 'openbox_started';

    const args = desktop
      ? ['--ozone-platform=x11', '--password-store=gnome-libsecret', '--disable-gpu']
      : [`--user-data-dir=${path.join(profileDirectory, 'chromium')}`, '--no-first-run', '--no-default-browser-check',
        '--disable-gpu', '--disable-component-update', '--password-store=basic', '--start-maximized',
        '--window-position=0,0', `--window-size=${width},${height}`, 'chrome://newtab/'];
    const browser = startChild(current, chromium, args, false);
    current.chromium = browser;
    current.stage = 'browser_spawned';
    browser.on('exit', () => {
      if (session === current && current.state !== 'stopping') void stop(current, 'browser_closed');
    });
    const visible = await run(PROGRAMS.xdotool, ['search', '--sync', '--onlyvisible', '--class', desktop ? '[Cc]laude' : '[Cc]hromium'], current.env, { timeoutMs: 30_000, signal: current.startupAbort.signal });
    if (visible.code !== 0) throw new Error('Chromium window did not appear');
    current.stage = 'browser_visible';
    for (const child of [xvnc, openbox]) {
      child.on('exit', () => {
        if (session === current && current.state !== 'stopping') void stop(current, 'display_exited');
      });
    }
  }

  function begin(sid: string, width: number, height: number): Session {
    const display = `:${freeDisplay()}`;
    const current: Session = {
      sid, state: 'starting', stage: 'request', reason: null, display,
      env: {
        HOME: homeDirectory, USER: process.env.USER, LOGNAME: process.env.LOGNAME, PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: process.env.LANG ?? 'C.UTF-8', DISPLAY: display, XDG_RUNTIME_DIR: runDirectory,
        XDG_CONFIG_HOME: profileDirectory,
        ...(desktop ? { XDG_DATA_HOME: path.join(profileDirectory, 'data'), XDG_CACHE_HOME: path.join(homeDirectory, '.cache', 'claudeweb-desktop-cache') } : {}),
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(runDirectory, 'bus')}`,
        GTK_IM_MODULE: 'fcitx', QT_IM_MODULE: 'fcitx', XMODIFIERS: '@im=fcitx', NO_AT_BRIDGE: '1',
      },
      vncSocket: path.join(runDirectory, 'vnc.sock'),
      children: [], chromium: null, client: null, detachTimer: null, stopping: null,
      startupAbort: new AbortController(),
      ready: Promise.resolve(),
    };
    current.ready = launch(current, width, height).catch(async (error: unknown) => {
      console.error('[Browser] start failed:', error instanceof Error ? error.message : String(error));
      await stop(current, current.stage === 'browser_spawned' ? 'application_start_timeout' : 'display_start_timeout');
      throw error;
    });
    return current;
  }

  function attach(current: Session, client: WebSocket) {
    const vnc = net.createConnection(current.vncSocket);
    current.client = client;
    current.state = 'open';
    current.stage = 'websocket_ready';
    if (current.detachTimer) { clearTimeout(current.detachTimer); current.detachTimer = null; }
    let paused = false;
    const flow = setInterval(() => {
      if (paused && client.bufferedAmount < LOW) { paused = false; vnc.resume(); }
    }, 50);
    flow.unref?.();
    vnc.on('data', (chunk) => {
      if (client.readyState !== WebSocket.OPEN) return;
      client.send(chunk, { binary: true });
      if (!paused && client.bufferedAmount > HIGH) { paused = true; vnc.pause(); }
    });
    vnc.on('error', () => { if (client.readyState === WebSocket.OPEN) client.close(4502, 'Browser connection failed'); });
    vnc.on('close', () => { clearInterval(flow); if (client.readyState === WebSocket.OPEN) client.close(1000); });
    client.on('message', (data, isBinary) => {
      if (!isBinary) { client.close(1008, 'Binary frames only'); return; }
      vnc.write(data as Buffer);
    });
    client.on('close', (code) => {
      clearInterval(flow);
      vnc.destroy();
      if (current.client !== client) return;
      current.client = null;
      if (current.state === 'stopping') return;
      // A deliberate close (the panel was closed) ends the browser; a dropped
      // connection keeps it a while for the page to come back to.
      if (code === 1000 || code === 1005) { void stop(current, 'browser_closed_by_user'); return; }
      current.state = 'detached';
      current.detachTimer = setTimeout(() => void stop(current, 'disconnected_timeout'), DETACHED_KEEP_MS);
      current.detachTimer.unref?.();
    });
    client.on('error', () => vnc.destroy());
  }

  function liveSession(sid: string): Session {
    if (!session || session.sid !== sid || session.state === 'stopping') {
      throw new AppError('The browser is not running for this panel.', { code: 'GUI_INACTIVE', statusCode: 409 });
    }
    return session;
  }

  async function clipboardTargets(current: Session) {
    const targets = await run(PROGRAMS.xclip, ['-selection', 'clipboard', '-out', '-target', 'TARGETS'], current.env, { maxBytes: 4096 });
    return targets.code === 0 ? targets.stdout.toString('utf8').split('\n').map((line) => line.trim()).filter(Boolean) : null;
  }

  async function clipboardStamp(current: Session): Promise<string | null> {
    const stamp = await run(PROGRAMS.xclip, ['-selection', 'clipboard', '-out', '-target', 'TIMESTAMP'], current.env, { timeoutMs: 250, maxBytes: 16 });
    return stamp.code === 0 ? stamp.stdout.toString('utf8').trim() : null;
  }

  return {
    available,

    /** Server shutdown uses the same bounded process and cache cleanup as explicit Close. */
    async shutdown(): Promise<void> {
      if (session) await stop(session, 'application_exited');
    },

    async status(sid: unknown): Promise<GraphicalReply> {
      const id = requireSid(sid);
      if (session && session.sid === id) {
        return jsonReply({ state: session.state, stage: session.stage, reason: session.reason });
      }
      const reason = ended.get(id);
      return jsonReply(reason ? { state: 'ended', reason: reason === 'browser_closed_by_user' ? null : reason } : { state: 'none' });
    },

    /** Text clipboard, only when the user asks: copy/cut send the shortcut to the page first. */
    async text(body: unknown): Promise<GraphicalReply> {
      const request = (body ?? {}) as { sid?: unknown; op?: unknown; text?: unknown };
      const current = liveSession(requireSid(request.sid));
      const op = request.op;
      if (op === 'write') {
        if (typeof request.text !== 'string') return jsonReply({ ok: false, code: 'INVALID_REQUEST' });
        const data = Buffer.from(request.text, 'utf8');
        if (data.length > TEXT_MAX) return jsonReply({ ok: false, code: 'TOO_LARGE' });
        const problem = textProblem(request.text);
        if (problem) return jsonReply({ ok: false, code: problem });
        const owned = await run(PROGRAMS.xclip, ['-selection', 'clipboard', '-in', '-target', 'UTF8_STRING'], current.env, { input: data });
        return jsonReply({ ok: owned.code === 0, code: owned.code === 0 ? 'OK' : 'UNAVAILABLE' });
      }
      if (op === 'copy' || op === 'cut') {
        const before = await clipboardStamp(current);
        const pressed = await run(PROGRAMS.xdotool, ['key', '--clearmodifiers', op === 'copy' ? 'ctrl+c' : 'ctrl+x'], current.env, { timeoutMs: 1000 });
        if (pressed.code !== 0) return jsonReply({ ok: false, code: 'UNAVAILABLE' });
        const deadline = Date.now() + 1000;
        let changed = false;
        while (Date.now() < deadline) {
          const stamp = await clipboardStamp(current);
          if (stamp && stamp !== before) { changed = true; break; }
          await wait(25);
        }
        if (!changed) return jsonReply({ ok: false, code: 'EMPTY' });
      } else if (op !== 'read') {
        return jsonReply({ ok: false, code: 'INVALID_REQUEST' });
      }
      const targets = await clipboardTargets(current);
      if (!targets || targets.length === 0) return jsonReply({ ok: false, code: 'EMPTY' });
      if (targets.some((target) => REJECTED_TARGETS.has(target) || target.startsWith('image/')) || !targets.includes('UTF8_STRING')) {
        return jsonReply({ ok: false, code: 'NON_TEXT' });
      }
      const read = await run(PROGRAMS.xclip, ['-selection', 'clipboard', '-out', '-target', 'UTF8_STRING'], current.env, { maxBytes: TEXT_MAX });
      if (read.tooLarge) return jsonReply({ ok: false, code: 'TOO_LARGE' });
      if (read.code !== 0) return jsonReply({ ok: false, code: 'UNAVAILABLE' });
      const text = new TextDecoder('utf-8', { fatal: true });
      let value: string;
      try { value = text.decode(read.stdout); } catch { return jsonReply({ ok: false, code: 'INVALID_UTF8' }); }
      const problem = textProblem(value);
      return problem ? jsonReply({ ok: false, code: problem }) : jsonReply({ ok: true, code: 'OK', text: value });
    },

    /** PNG image clipboard: read what the page copied, or put one image there to paste. */
    async image(sid: unknown, op: unknown, data?: Buffer): Promise<GraphicalReply> {
      const current = liveSession(requireSid(sid));
      if (op === 'write') {
        if (!data || data.length === 0) return jsonReply({ ok: false, code: 'EMPTY' });
        if (data.length > IMAGE_MAX) return jsonReply({ ok: false, code: 'TOO_LARGE' });
        if (!data.subarray(0, 8).equals(PNG_MAGIC)) return jsonReply({ ok: false, code: 'INVALID_IMAGE' });
        const owned = await run(PROGRAMS.xclip, ['-selection', 'clipboard', '-in', '-target', 'image/png'], current.env, { input: data });
        return jsonReply({ ok: owned.code === 0, code: owned.code === 0 ? 'OK' : 'UNAVAILABLE' });
      }
      if (op !== 'read') throw new AppError('Unknown image clipboard operation.', { code: 'INVALID_REQUEST', statusCode: 400 });
      const targets = await clipboardTargets(current);
      if (!targets?.includes('image/png')) return jsonReply({ ok: false, code: 'NON_IMAGE' });
      const read = await run(PROGRAMS.xclip, ['-selection', 'clipboard', '-out', '-target', 'image/png'], current.env, { maxBytes: IMAGE_MAX });
      if (read.tooLarge) return jsonReply({ ok: false, code: 'TOO_LARGE' });
      if (read.code !== 0 || !read.stdout.subarray(0, 8).equals(PNG_MAGIC)) return jsonReply({ ok: false, code: 'UNAVAILABLE' });
      return { status: 200, headers: { 'content-type': 'image/png' }, body: read.stdout };
    },

    /** Ends the browser (the panel was closed while its connection was down). */
    async end(sid: unknown): Promise<GraphicalReply> {
      const id = requireSid(sid);
      if (session && session.sid === id) await stop(session, 'browser_closed_by_user');
      return jsonReply({ ok: true });
    },

    /**
     * Connects one panel connection: starts the browser if none runs, takes it
     * over from another panel, or reattaches after a dropped connection.
     */
    relay(client: WebSocket, url: URL) {
      const sid = url.searchParams.get('sid') ?? '';
      const width = Number(url.searchParams.get('w')), height = Number(url.searchParams.get('h'));
      if (!SID.test(sid) || !Number.isInteger(width) || !Number.isInteger(height)) {
        client.close(4400, 'Invalid browser request');
        return;
      }
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)), h = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height));
      void (async () => {
        if (!(await available())) { client.close(4503, 'Browser unavailable'); return; }
        if (client.readyState !== WebSocket.OPEN) return;
        let current = session;
        if (current?.state === 'stopping') {
          await current.stopping;
          if (client.readyState !== WebSocket.OPEN) return;
          current = session;
        }
        if (current && current.sid !== sid) {
          // Opened in another tab or device: that panel loses the browser.
          const previous = current.client;
          remember(current.sid, 'browser_moved');
          current.sid = sid;
          current.client = null;
          if (previous && previous.readyState === WebSocket.OPEN) previous.close(4001, 'Browser moved');
        }
        if (!current) {
          current = begin(sid, w, h);
          session = current;
        }
        try {
          await current.ready;
        } catch {
          if (client.readyState === WebSocket.OPEN) client.close(4503, 'Browser could not start');
          return;
        }
        if (client.readyState !== WebSocket.OPEN || session !== current || current.sid !== sid) {
          if (session === current && current.sid === sid && !current.client) await stop(current, 'browser_closed_by_user');
          return;
        }
        if (current.client && current.client !== client && current.client.readyState === WebSocket.OPEN) current.client.close(4001, 'Browser moved');
        attach(current, client);
      })();
    },
  };
}
