// @ts-nocheck -- subprocess records are narrowed at the Plugins composition boundary.
import fs from 'node:fs';
import path from 'node:path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { PLUGIN_API_VERSION } from './plugin-contract.js';
import { ensurePluginDataDir, getPluginDir, getPluginsConfig, scanPlugins } from './plugin-registry.service.js';

// Map<pluginName, { process, port }>
const runningPlugins = new Map();
// Map<pluginName, Promise<port>> — in-flight start operations
const startingPlugins = new Map();
// Map<pluginName, { crashes: number[], lastError: string | null, circuitOpenUntil: number | null }>
const pluginHealth = new Map();

const CRASH_WINDOW_MS = 5 * 60_000;
const CRASH_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 5 * 60_000;

const HOST_VERSION = (() => {
  try {
    const root = findApplicationRoot(getModuleDirectory(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function getHealthRecord(name) {
  let rec = pluginHealth.get(name);
  if (!rec) {
    rec = { crashes: [], lastError: null, circuitOpenUntil: null };
    pluginHealth.set(name, rec);
  }
  return rec;
}

function recordFailure(name, message) {
  const rec = getHealthRecord(name);
  const now = Date.now();
  rec.crashes = rec.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
  rec.crashes.push(now);
  rec.lastError = message;
  if (rec.crashes.length >= CRASH_THRESHOLD) {
    rec.circuitOpenUntil = now + CIRCUIT_OPEN_MS;
  }
}

export function resetPluginCircuit(name) {
  pluginHealth.delete(name);
}

export function getPluginProcessState(name) {
  const running = runningPlugins.has(name);
  const rec = pluginHealth.get(name);
  const now = Date.now();
  const circuitOpen = Boolean(rec?.circuitOpenUntil && rec.circuitOpenUntil > now);
  return {
    running,
    lastError: rec?.lastError ?? null,
    circuitOpen,
  };
}

/**
 * Build the environment handed to a plugin server subprocess.
 *
 * Intentionally minimal: only non-secret essentials, never the host's full
 * environment. Also provides PLUGIN_DATA_DIR (under ~/.claude-code-ui/plugin-data/<name>)
 * so plugins store user data outside their git checkout directory.
 */
function buildPluginEnv(name) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV || 'production',
    PLUGIN_NAME: name,
    CLAUDEWEB_HOST_VERSION: HOST_VERSION,
    CLAUDEWEB_PLUGIN_API_VERSION: String(PLUGIN_API_VERSION),
  };

  // Internal workers (e.g. @claudeweb/local-history) skip user plugin data dirs.
  if (/^[a-zA-Z0-9_-]+$/.test(name)) {
    try {
      env.PLUGIN_DATA_DIR = ensurePluginDataDir(name);
    } catch (err) {
      console.warn(`[Plugins] Could not prepare PLUGIN_DATA_DIR for "${name}":`, err.message);
    }
  }

  if (process.platform === 'win32') {
    const WINDOWS_ESSENTIALS = [
      'SystemRoot', 'windir', 'SystemDrive',
      'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
      'TEMP', 'TMP', 'PATHEXT',
    ];
    for (const key of WINDOWS_ESSENTIALS) {
      if (process.env[key] !== undefined) {
        env[key] = process.env[key];
      }
    }
  }

  return env;
}

/**
 * Start a plugin's server subprocess.
 * The plugin's server entry must print a JSON line with { ready: true, port: <number> }
 * to stdout within 10 seconds.
 */
export function startPluginServer(name, pluginDir, serverEntry) {
  if (runningPlugins.has(name)) {
    return Promise.resolve(runningPlugins.get(name).port);
  }

  const health = pluginHealth.get(name);
  if (health?.circuitOpenUntil && health.circuitOpenUntil > Date.now()) {
    return Promise.reject(new Error(`Plugin server "${name}" crashed repeatedly and is temporarily paused. Re-enable or restart it from Settings > Plugins.`));
  }

  // Coalesce concurrent starts for the same plugin
  if (startingPlugins.has(name)) {
    return startingPlugins.get(name);
  }

  const startPromise = new Promise((resolve, reject) => {
    const serverPath = path.join(pluginDir, serverEntry);

    const pluginProcess = spawn('node', [serverPath], {
      cwd: pluginDir,
      env: buildPluginEnv(name),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    let stdout = '';

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        pluginProcess.kill();
        const msg = 'Plugin server did not report ready within 10 seconds';
        recordFailure(name, msg);
        reject(new Error(msg));
      }
    }, 10000);

    pluginProcess.stdout.on('data', (data) => {
      if (resolved) return;
      stdout += data.toString();

      // Look for the JSON ready line
      const lines = stdout.split('\n');
      for (const line of lines) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.ready && typeof msg.port === 'number') {
            clearTimeout(timeout);
            resolved = true;
            const rec = getHealthRecord(name);
            rec.lastError = null;
            rec.circuitOpenUntil = null;
            runningPlugins.set(name, { process: pluginProcess, port: msg.port, stopping: false });

            pluginProcess.on('exit', (exitCode) => {
              const entry = runningPlugins.get(name);
              runningPlugins.delete(name);
              if (entry && !entry.stopping && exitCode !== 0) {
                recordFailure(name, `Plugin server exited unexpectedly (code ${exitCode ?? 'signal'})`);
              }
            });

            console.log(`[Plugins] Server started for "${name}" on port ${msg.port}`);
            resolve(msg.port);
          }
        } catch {
          // Not JSON yet, keep buffering
        }
      }
    });

    pluginProcess.stderr.on('data', (data) => {
      console.warn(`[Plugin:${name}] ${data.toString().trim()}`);
    });

    pluginProcess.on('error', (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        const msg = `Failed to start plugin server: ${err.message}`;
        recordFailure(name, msg);
        reject(new Error(msg));
      }
    });

    pluginProcess.on('exit', (code) => {
      clearTimeout(timeout);
      runningPlugins.delete(name);
      if (!resolved) {
        resolved = true;
        const msg = `Plugin server exited with code ${code} before reporting ready`;
        recordFailure(name, msg);
        reject(new Error(msg));
      }
    });
  }).finally(() => {
    startingPlugins.delete(name);
  });

  startingPlugins.set(name, startPromise);
  return startPromise;
}

/**
 * Stop a plugin's server subprocess.
 * Returns a Promise that resolves when the process has fully exited.
 */
export function stopPluginServer(name) {
  const entry = runningPlugins.get(name);
  if (!entry) return Promise.resolve();
  entry.stopping = true;

  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(forceKillTimer);
      runningPlugins.delete(name);
      resolve();
    };

    entry.process.once('exit', cleanup);

    entry.process.kill('SIGTERM');

    // Force kill after 5 seconds if still running
    const forceKillTimer = setTimeout(() => {
      if (runningPlugins.has(name)) {
        entry.process.kill('SIGKILL');
        cleanup();
      }
    }, 5000);

    console.log(`[Plugins] Server stopped for "${name}"`);
  });
}

/**
 * Get the port a running plugin server is listening on.
 */
export function getPluginPort(name) {
  return runningPlugins.get(name)?.port ?? null;
}

/**
 * Check if a plugin's server is running.
 */
export function isPluginRunning(name) {
  return runningPlugins.has(name);
}

/**
 * Stop all running plugin servers (called on host shutdown).
 */
export function stopAllPlugins() {
  const stops = [];
  for (const [name] of runningPlugins) {
    stops.push(stopPluginServer(name));
  }
  return Promise.all(stops);
}

/**
 * Start servers for all enabled plugins that have a server entry.
 * Called once on host server boot.
 */
export async function startEnabledPluginServers() {
  const plugins = scanPlugins();
  const config = getPluginsConfig();

  for (const plugin of plugins) {
    if (!plugin.server) continue;
    if (plugin.compatible === false) continue;
    if (config[plugin.name]?.enabled === false) continue;

    const pluginDir = getPluginDir(plugin.name);
    if (!pluginDir) continue;

    try {
      await startPluginServer(plugin.name, pluginDir, plugin.server);
    } catch (err) {
      console.error(`[Plugins] Failed to start server for "${plugin.name}":`, err.message);
    }
  }
}

export function getHostVersion() {
  return HOST_VERSION;
}
