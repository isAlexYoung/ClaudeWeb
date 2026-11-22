import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function privateDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) {
    throw new Error('Unsafe ClaudeDesktop profile directory');
  }
}

function dbus(env: NodeJS.ProcessEnv, args: string[]) {
  return new Promise<string>((resolve) => {
    execFile('/usr/bin/dbus-send', ['--session', '--print-reply', ...args],
      { env, timeout: 1000, maxBuffer: 65536 }, (error, stdout) => resolve(error ? '' : stdout));
  });
}

/** The graphical session uses a persistent private keyring; its unlock secret never enters argv or logs. */
export async function startDesktopKeyring(profile: string, env: NodeJS.ProcessEnv, register: (child: ChildProcess) => void): Promise<void> {
  privateDirectory(profile);
  const data = env.XDG_DATA_HOME!;
  privateDirectory(data);
  const seed = path.join(profile, '.keyring-secret');
  if (!fs.existsSync(seed)) {
    const rings = path.join(data, 'keyrings');
    if (fs.existsSync(rings) && fs.readdirSync(rings).length) throw new Error('Existing keyring has no unlock secret');
    fs.writeFileSync(seed, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  }
  const fd = fs.openSync(seed, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let secret: Buffer;
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid?.() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size !== 64) {
      throw new Error('Unsafe ClaudeDesktop keyring secret');
    }
    secret = fs.readFileSync(fd);
    if (!/^[a-f0-9]{64}$/.test(secret.toString('ascii'))) throw new Error('Invalid keyring secret');
  } finally { fs.closeSync(fd); }
  const control = path.join(env.XDG_RUNTIME_DIR!, 'keyring');
  privateDirectory(control);
  const child = spawn('/usr/bin/gnome-keyring-daemon', ['--foreground', '--components=secrets', `--control-directory=${control}`, '--unlock'],
    { cwd: env.HOME, env, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  register(child);
  let failed = false;
  child.on('error', () => { failed = true; });
  child.stdin?.on('error', () => { failed = true; });
  child.stdin?.end(secret, () => secret.fill(0));
  const deadline = Date.now() + 6000;
  while (!failed && child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    const alias = await dbus(env, ['--dest=org.freedesktop.secrets', '/org/freedesktop/secrets', 'org.freedesktop.Secret.Service.ReadAlias', 'string:default']);
    const collection = alias.match(/object path "(\/org\/freedesktop\/secrets\/collection\/[A-Za-z0-9_]+)"/)?.[1];
    if (collection) {
      const locked = await dbus(env, ['--dest=org.freedesktop.secrets', collection, 'org.freedesktop.DBus.Properties.Get',
        'string:org.freedesktop.Secret.Collection', 'string:Locked']);
      if (locked.includes('boolean false')) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
  throw new Error('ClaudeDesktop keyring could not be unlocked');
}

/** Called only after Desktop's process groups stopped; deletes regenerable caches, never profile/login databases. */
export function cleanDesktopCaches(home: string): void {
  const base = fs.realpathSync(home);
  const profile = '.config/claudeweb-desktop/Claude';
  const targets = ['.cache/claudeweb-desktop-cache', ...['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache', 'ShaderCache'].map((name) => `${profile}/${name}`)];
  for (const relative of targets) {
    let current = base;
    const parts = relative.split('/');
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      let info: fs.Stats;
      try { info = fs.lstatSync(current); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
      if (info.uid !== process.getuid?.()) throw new Error('Cache ownership changed');
      if (index < parts.length - 1 && (!info.isDirectory() || info.isSymbolicLink())) break;
      if (index === parts.length - 1) fs.rmSync(current, { recursive: true, force: true });
    }
  }
}
