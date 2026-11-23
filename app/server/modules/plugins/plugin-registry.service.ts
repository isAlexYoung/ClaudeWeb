// @ts-nocheck -- the registry's dynamic manifest schema is narrowed by Plugins service adapters.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { spawn } from 'cross-spawn';

import { AppError } from '@/shared/utils.js';

import { installDependenciesIfNeeded, runBuildIfNeeded } from './plugin-build.service.js';
import {
  ALLOWED_PLUGIN_SLOTS,
  HOST_CAPABILITY_SET,
  PLUGIN_API_VERSION,
} from './plugin-contract.js';
import {
  createPluginGitError, createPluginGitSpawnError, getPluginGitSpawnOptions, stopPluginGitOnServerExit,
} from './plugin-git.service.js';

const PLUGINS_DIR = path.join(os.homedir(), '.claude-code-ui', 'plugins');
const PLUGIN_DATA_ROOT = path.join(os.homedir(), '.claude-code-ui', 'plugin-data');
const PLUGINS_CONFIG_PATH = path.join(os.homedir(), '.claude-code-ui', 'plugins.json');

const REQUIRED_MANIFEST_FIELDS = ['name', 'displayName', 'entry'];
const ALLOWED_TYPES = ['react', 'module'];
const ALLOWED_SLOTS = [...ALLOWED_PLUGIN_SLOTS];
const INTEGRITY_PATTERN = /^sha256-([a-f0-9]{64}|[A-Za-z0-9+/]{43}=)$/;

/** Strip embedded credentials from a repo URL before exposing it to the client. */
function sanitizeRepoUrl(raw) {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    // Not a parseable URL (e.g. SSH shorthand) — strip user:pass@ segment
    return raw.replace(/\/\/[^@/]+@/, '//');
  }
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && !value.includes('..')
    && !value.includes('\\')
    && !/[\x00-\x1f\x7f]/.test(value)
    && !path.isAbsolute(value);
}

export function getPluginsDir() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
  return PLUGINS_DIR;
}

export function getPluginDataDir(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid plugin name', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
  }
  const resolved = path.resolve(PLUGIN_DATA_ROOT, name);
  if (!resolved.startsWith(path.resolve(PLUGIN_DATA_ROOT) + path.sep)) {
    throw new AppError('Invalid plugin data directory', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
  }
  return resolved;
}

export function ensurePluginDataDir(name) {
  const dir = getPluginDataDir(name);
  if (!fs.existsSync(PLUGIN_DATA_ROOT)) {
    fs.mkdirSync(PLUGIN_DATA_ROOT, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function getPluginsConfig() {
  try {
    if (fs.existsSync(PLUGINS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(PLUGINS_CONFIG_PATH, 'utf-8'));
    }
  } catch {
    // Corrupted config, start fresh
  }
  return {};
}

export function savePluginsConfig(config) {
  const dir = path.dirname(PLUGINS_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const temp = `${PLUGINS_CONFIG_PATH}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(temp, PLUGINS_CONFIG_PATH);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* ignore */ }
  }
}

export function normalizeManifestSlots(manifest) {
  if (Array.isArray(manifest.slots) && manifest.slots.length > 0) {
    return [...new Set(manifest.slots)];
  }
  return [manifest.slot || 'tab'];
}

export function normalizePanelConfig(panel) {
  if (!panel || typeof panel !== 'object' || Array.isArray(panel)) {
    return { mode: 'drawer', width: 520 };
  }
  const mode = panel.mode === 'modal' ? 'modal' : 'drawer';
  const width = typeof panel.width === 'number' && Number.isFinite(panel.width)
    ? Math.min(960, Math.max(320, Math.round(panel.width)))
    : 520;
  return {
    ...(typeof panel.title === 'string' && panel.title.trim() ? { title: panel.title.trim().slice(0, 80) } : {}),
    mode,
    width,
  };
}

/**
 * Validates plugin manifest (v1 and v2).
 * Unknown optional fields are tolerated for forward compatibility.
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, error: 'Manifest must be a JSON object' };
  }

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      return { valid: false, error: `Missing or invalid required field: ${field}` };
    }
  }

  // Sanitize name — only allow alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(manifest.name)) {
    return { valid: false, error: 'Plugin name must only contain letters, numbers, hyphens, and underscores' };
  }

  if (manifest.manifestVersion !== undefined) {
    if (!Number.isInteger(manifest.manifestVersion) || manifest.manifestVersion < 1) {
      return { valid: false, error: 'manifestVersion must be a positive integer' };
    }
  }

  if (manifest.minPluginApi !== undefined) {
    if (!Number.isInteger(manifest.minPluginApi) || manifest.minPluginApi < 1) {
      return { valid: false, error: 'minPluginApi must be a positive integer' };
    }
  }

  if (manifest.requiredCapabilities !== undefined) {
    if (
      !Array.isArray(manifest.requiredCapabilities)
      || !manifest.requiredCapabilities.every((cap) => typeof cap === 'string' && cap.trim().length > 0)
    ) {
      return { valid: false, error: 'requiredCapabilities must be an array of non-empty strings' };
    }
  }

  if (manifest.type && !ALLOWED_TYPES.includes(manifest.type)) {
    return { valid: false, error: `Invalid plugin type: ${manifest.type}. Must be one of: ${ALLOWED_TYPES.join(', ')}` };
  }

  if (manifest.slot && !ALLOWED_SLOTS.includes(manifest.slot)) {
    return { valid: false, error: `Invalid plugin slot: ${manifest.slot}. Must be one of: ${ALLOWED_SLOTS.join(', ')}` };
  }

  if (manifest.slots !== undefined) {
    if (!Array.isArray(manifest.slots) || manifest.slots.length === 0) {
      return { valid: false, error: 'slots must be a non-empty array of slot names' };
    }
    for (const s of manifest.slots) {
      if (typeof s !== 'string' || !ALLOWED_SLOTS.includes(s)) {
        return { valid: false, error: `Invalid plugin slot: ${String(s)}. Must be one of: ${ALLOWED_SLOTS.join(', ')}` };
      }
    }
  }

  if (manifest.panel !== undefined && manifest.panel !== null) {
    if (typeof manifest.panel !== 'object' || Array.isArray(manifest.panel)) {
      return { valid: false, error: 'panel must be an object' };
    }
    if (manifest.panel.mode !== undefined && manifest.panel.mode !== 'drawer' && manifest.panel.mode !== 'modal') {
      return { valid: false, error: 'panel.mode must be "drawer" or "modal"' };
    }
    if (manifest.panel.width !== undefined && (typeof manifest.panel.width !== 'number' || !Number.isFinite(manifest.panel.width))) {
      return { valid: false, error: 'panel.width must be a number' };
    }
  }

  if (manifest.publicAppearance !== undefined && typeof manifest.publicAppearance !== 'boolean') {
    return { valid: false, error: 'publicAppearance must be a boolean' };
  }

  // Validate entry is a relative path without traversal
  if (!isSafeRelativePath(manifest.entry)) {
    return { valid: false, error: 'Entry must be a relative path without ".."' };
  }

  if (manifest.server !== undefined && manifest.server !== null) {
    if (!isSafeRelativePath(manifest.server)) {
      return { valid: false, error: 'Server entry must be a relative path string without ".."' };
    }
  }

  if (manifest.icon !== undefined && manifest.icon !== null && typeof manifest.icon !== 'string') {
    return { valid: false, error: 'Icon must be a string' };
  }

  if (manifest.build !== undefined && manifest.build !== null) {
    if (typeof manifest.build !== 'object' || Array.isArray(manifest.build)) {
      return { valid: false, error: 'build must be an object' };
    }
    if (manifest.build.mode !== undefined && manifest.build.mode !== 'auto' && manifest.build.mode !== 'prebuilt') {
      return { valid: false, error: 'build.mode must be "auto" or "prebuilt"' };
    }
    if (manifest.build.integrity !== undefined) {
      if (!manifest.build.integrity || typeof manifest.build.integrity !== 'object' || Array.isArray(manifest.build.integrity)) {
        return { valid: false, error: 'build.integrity must be an object mapping file paths to sha256 digests' };
      }
      for (const [relPath, digest] of Object.entries(manifest.build.integrity)) {
        if (!isSafeRelativePath(relPath) || typeof digest !== 'string' || !INTEGRITY_PATTERN.test(digest)) {
          return { valid: false, error: `Invalid build.integrity entry for "${relPath}"` };
        }
      }
    }
  }

  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions) || !manifest.permissions.every(p => typeof p === 'string')) {
      return { valid: false, error: 'Permissions must be an array of strings' };
    }
  }

  return { valid: true };
}

export function checkPluginCompatibility(manifest) {
  if (typeof manifest.minPluginApi === 'number' && manifest.minPluginApi > PLUGIN_API_VERSION) {
    return {
      compatible: false,
      reason: `Requires plugin API v${manifest.minPluginApi}, but this ClaudeWeb host provides API v${PLUGIN_API_VERSION}. Please update ClaudeWeb.`,
    };
  }
  if (Array.isArray(manifest.requiredCapabilities)) {
    const missing = manifest.requiredCapabilities.filter((cap) => !HOST_CAPABILITY_SET.has(cap));
    if (missing.length > 0) {
      return {
        compatible: false,
        reason: `Requires host capabilities not supported by this ClaudeWeb version: ${missing.join(', ')}.`,
      };
    }
  }
  return { compatible: true, reason: null };
}

function resolveRegularFileInside(rootDir, relativePath) {
  if (!isSafeRelativePath(relativePath)) return null;
  const candidate = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(candidate)) return null;
  const realRoot = fs.realpathSync(rootDir);
  const realTarget = fs.realpathSync(candidate);
  if (!realTarget.startsWith(realRoot + path.sep)) return null;
  const stat = fs.statSync(realTarget);
  if (!stat.isFile()) return null;
  return realTarget;
}

/**
 * Verifies declared entry/server artifacts exist inside the plugin directory,
 * and checks SHA-256 digests when `build.integrity` is provided.
 */
export function verifyPluginArtifacts(pluginDir, manifest) {
  const entryPath = resolveRegularFileInside(pluginDir, manifest.entry);
  if (!entryPath) {
    throw new AppError(`Plugin entry file "${manifest.entry}" was not found after installation`, {
      code: 'PLUGIN_ARTIFACT_MISSING',
      statusCode: 422,
    });
  }
  if (manifest.server) {
    const serverPath = resolveRegularFileInside(pluginDir, manifest.server);
    if (!serverPath) {
      throw new AppError(`Plugin server file "${manifest.server}" was not found after installation`, {
        code: 'PLUGIN_ARTIFACT_MISSING',
        statusCode: 422,
      });
    }
  }

  const integrity = manifest.build?.integrity;
  if (integrity && typeof integrity === 'object') {
    for (const [relPath, expected] of Object.entries(integrity)) {
      const target = resolveRegularFileInside(pluginDir, relPath);
      if (!target) {
        throw new AppError(`Integrity check failed: "${relPath}" is missing`, {
          code: 'PLUGIN_INTEGRITY_MISMATCH',
          statusCode: 422,
        });
      }
      const rawBytes = fs.readFileSync(target);
      const digestValue = expected.slice('sha256-'.length);
      const encoding = digestValue.length === 64 ? 'hex' : 'base64';
      const actual = crypto.createHash('sha256').update(rawBytes).digest(encoding);
      const actualBuf = Buffer.from(actual, 'utf8');
      const expectedBuf = Buffer.from(digestValue, 'utf8');
      if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
        throw new AppError(`Integrity check failed: SHA-256 mismatch for "${relPath}"`, {
          code: 'PLUGIN_INTEGRITY_MISMATCH',
          statusCode: 422,
        });
      }
    }
  }
}

export function shouldSkipBuild(pluginDir, manifest) {
  if (manifest.build?.mode === 'prebuilt') return true;
  return !fs.existsSync(path.join(pluginDir, 'package.json'));
}

function preparePluginDirectory(dir, manifest) {
  return new Promise((resolve, reject) => {
    const compat = checkPluginCompatibility(manifest);
    if (!compat.compatible) {
      return reject(new AppError(compat.reason, { code: 'PLUGIN_INCOMPATIBLE', statusCode: 422 }));
    }
    if (shouldSkipBuild(dir, manifest)) {
      try {
        verifyPluginArtifacts(dir, manifest);
        return resolve();
      } catch (err) {
        return reject(err);
      }
    }

    const packageJsonPath = path.join(dir, 'package.json');
    installDependenciesIfNeeded(
      dir,
      packageJsonPath,
      () => {
        runBuildIfNeeded(
          dir,
          packageJsonPath,
          () => {
            try {
              verifyPluginArtifacts(dir, manifest);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          reject,
        );
      },
      reject,
    );
  });
}

export function scanPlugins() {
  const pluginsDir = getPluginsDir();
  const config = getPluginsConfig();
  const activeBackgroundPlugin = typeof config._host?.activeBackgroundPlugin === 'string'
    ? config._host.activeBackgroundPlugin
    : null;
  const overlayOrder = Array.isArray(config._host?.overlayOrder) ? config._host.overlayOrder : [];
  const plugins = [];

  // The integrated build ships reviewed quota code read-only; a user's own
  // installation of the same plugin takes precedence.
  const roots = [pluginsDir, process.env.CLAUDEWEB_BUNDLED_PLUGINS_DIR].filter(Boolean);
  const entries = roots.flatMap(root => {
    try { return fs.readdirSync(root, { withFileTypes: true }).map(entry => ({ entry, root })); }
    catch { return []; }
  });

  const seenNames = new Set();

  for (const { entry, root } of entries) {
    if (!entry.isDirectory()) continue;
    // Skip transient temp directories from in-progress installs/updates
    if (entry.name.startsWith('.tmp-')) continue;

    const manifestPath = path.join(root, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const validation = validateManifest(manifest);
      if (!validation.valid) {
        console.warn(`[Plugins] Skipping ${entry.name}: ${validation.error}`);
        continue;
      }

      // Skip duplicate manifest names
      if (seenNames.has(manifest.name)) {
        console.warn(`[Plugins] Skipping ${entry.name}: duplicate plugin name "${manifest.name}"`);
        continue;
      }
      seenNames.add(manifest.name);

      // Try to read git remote URL
      let repoUrl = null;
      try {
        const gitConfigPath = path.join(root, entry.name, '.git', 'config');
        if (fs.existsSync(gitConfigPath)) {
          const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
          const match = gitConfig.match(/url\s*=\s*(.+)/);
          if (match) {
            repoUrl = match[1].trim().replace(/\.git$/, '');
            // Convert SSH URLs to HTTPS
            if (repoUrl.startsWith('git@')) {
              repoUrl = repoUrl.replace(/^git@([^:]+):/, 'https://$1/');
            }
            // Strip embedded credentials (e.g. https://user:pass@host/...)
            repoUrl = sanitizeRepoUrl(repoUrl);
          }
        }
      } catch { /* ignore */ }

      const slots = normalizeManifestSlots(manifest);
      const compat = checkPluginCompatibility(manifest);
      const enabled = compat.compatible && config[manifest.name]?.enabled !== false;
      const overlayIndex = overlayOrder.indexOf(manifest.name);

      plugins.push({
        name: manifest.name,
        displayName: manifest.displayName,
        version: manifest.version || '0.0.0',
        description: manifest.description || '',
        author: manifest.author || '',
        icon: manifest.icon || 'Puzzle',
        type: manifest.type || 'module',
        slot: slots[0] || 'tab',
        slots,
        manifestVersion: manifest.manifestVersion || 1,
        minPluginApi: manifest.minPluginApi ?? 1,
        requiredCapabilities: manifest.requiredCapabilities || [],
        panel: slots.includes('settings') ? normalizePanelConfig(manifest.panel) : null,
        publicAppearance: manifest.publicAppearance === true,
        compatible: compat.compatible,
        incompatibilityReason: compat.reason,
        activeBackground: enabled && slots.includes('background') && activeBackgroundPlugin === manifest.name,
        overlayOrder: overlayIndex >= 0 ? overlayIndex : null,
        entry: manifest.entry,
        server: manifest.server || null,
        permissions: manifest.permissions || [],
        enabled,
        dirName: entry.name,
        bundled: root !== pluginsDir,
        repoUrl,
      });
    } catch (err) {
      console.warn(`[Plugins] Failed to read manifest for ${entry.name}:`, err.message);
    }
  }

  return plugins;
}

export function getPluginDir(name) {
  const plugins = scanPlugins();
  const plugin = plugins.find(p => p.name === name);
  if (!plugin) return null;
  return path.join(plugin.bundled ? process.env.CLAUDEWEB_BUNDLED_PLUGINS_DIR : getPluginsDir(), plugin.dirName);
}

export function resolvePluginAssetPath(name, assetPath) {
  const pluginDir = getPluginDir(name);
  if (!pluginDir) return null;

  const resolved = path.resolve(pluginDir, assetPath);

  // Prevent path traversal — canonicalize via realpath to defeat symlink bypasses
  if (!fs.existsSync(resolved)) return null;

  const realResolved = fs.realpathSync(resolved);
  const realPluginDir = fs.realpathSync(pluginDir);
  if (!realResolved.startsWith(realPluginDir + path.sep) && realResolved !== realPluginDir) {
    return null;
  }

  return realResolved;
}

async function renameWithRetry(source, target) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, target);
      return;
    } catch (err) {
      if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code) && attempt < 10) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      } else {
        throw err;
      }
    }
  }
}

async function rmDirWithRetry(target) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code) && attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      } else {
        throw err;
      }
    }
  }
}

export function installPluginFromGit(url) {
  return new Promise((resolve, reject) => {
    if (typeof url !== 'string' || !url.trim()) {
      return reject(new Error('Invalid URL: must be a non-empty string'));
    }
    if (url.startsWith('-')) {
      return reject(new Error('Invalid URL: must not start with "-"'));
    }

    // Extract repo name from URL for directory name
    const urlClean = url.replace(/\.git$/, '').replace(/\/$/, '');
    const repoName = urlClean.split('/').pop();

    if (!repoName || !/^[a-zA-Z0-9_.-]+$/.test(repoName)) {
      return reject(new Error('Could not determine a valid directory name from the URL'));
    }

    const pluginsDir = getPluginsDir();
    const targetDir = path.resolve(pluginsDir, repoName);

    // Ensure the resolved target directory stays within the plugins directory
    if (!targetDir.startsWith(pluginsDir + path.sep)) {
      return reject(new Error('Invalid plugin directory path'));
    }

    if (fs.existsSync(targetDir)) {
      return reject(new Error(`Plugin directory "${repoName}" already exists`));
    }

    // Clone into a temp directory so scanPlugins() never sees a partially-installed plugin
    const tempDir = fs.mkdtempSync(path.join(pluginsDir, `.tmp-${repoName}-`));

    const cleanupTemp = () => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    };

    const finalize = (manifest) => {
      try {
        fs.renameSync(tempDir, targetDir);
      } catch (err) {
        cleanupTemp();
        return reject(new Error(`Failed to move plugin into place: ${err.message}`));
      }
      resolve(manifest);
    };

    const gitProcess = spawn('git', ['clone', '--depth', '1', '--', url, tempDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...getPluginGitSpawnOptions(),
    });
    stopPluginGitOnServerExit(gitProcess);

    let stderr = '';
    // Node still emits 'close' after a failed spawn; the 'error' handler has answered by then.
    let gitDidNotStart = false;
    gitProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    gitProcess.on('close', (code) => {
      if (gitDidNotStart) return;
      if (code !== 0) {
        cleanupTemp();
        const error = createPluginGitError('install', code, stderr);
        console.error(`[Plugins] git clone failed (exit code ${code}, ${error.code}):\n${error.details.gitOutput}`);
        return reject(error);
      }

      // Validate manifest exists
      const manifestPath = path.join(tempDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        cleanupTemp();
        return reject(new Error('Cloned repository does not contain a manifest.json'));
      }

      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        cleanupTemp();
        return reject(new Error('manifest.json is not valid JSON'));
      }

      const validation = validateManifest(manifest);
      if (!validation.valid) {
        cleanupTemp();
        return reject(new Error(`Invalid manifest: ${validation.error}`));
      }

      // Reject if another installed plugin already uses this name
      const existing = scanPlugins().find(p => p.name === manifest.name);
      if (existing) {
        cleanupTemp();
        return reject(new Error(`A plugin named "${manifest.name}" is already installed (in "${existing.dirName}")`));
      }

      preparePluginDirectory(tempDir, manifest)
        .then(() => finalize(manifest))
        .catch((err) => {
          cleanupTemp();
          reject(err);
        });
    });

    gitProcess.on('error', (err) => {
      gitDidNotStart = true;
      cleanupTemp();
      console.error('[Plugins] Failed to spawn git clone:', err.message);
      reject(createPluginGitSpawnError('install', err));
    });
  });
}

/**
 * Updates a git-installed plugin atomically in a staging directory before swapping
 * it into place. A failed pull, incompatible manifest or failed build leaves the
 * currently installed plugin directory untouched.
 */
export function updatePluginFromGit(name) {
  return new Promise((resolve, reject) => {
    const pluginDir = getPluginDir(name);
    if (!pluginDir) {
      return reject(new Error(`Plugin "${name}" not found`));
    }

    if (scanPlugins().find(plugin => plugin.name === name)?.bundled) {
      return reject(new Error('Bundled plugins are updated with ClaudeWeb.'));
    }

    const pluginsDir = getPluginsDir();
    const dirName = path.basename(pluginDir);
    const stageDir = fs.mkdtempSync(path.join(pluginsDir, `.tmp-update-${dirName}-`));
    const cleanupStage = () => {
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    };

    try {
      // Copy git checkout (excluding node_modules) so local changes, untracked files,
      // remote config and tracking branch behave identically to pulling in place,
      // without ever mutating the live directory on failure.
      fs.cpSync(pluginDir, stageDir, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (src) => path.basename(src) !== 'node_modules',
      });
    } catch (err) {
      cleanupStage();
      return reject(new Error(`Failed to stage plugin update: ${err.message}`));
    }

    const gitProcess = spawn('git', ['pull', '--ff-only', '--'], {
      cwd: stageDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...getPluginGitSpawnOptions(),
    });
    stopPluginGitOnServerExit(gitProcess);

    let stderr = '';
    let gitDidNotStart = false;
    gitProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    gitProcess.on('close', (code) => {
      if (gitDidNotStart) return;
      if (code !== 0) {
        cleanupStage();
        const error = createPluginGitError('update', code, stderr);
        console.error(`[Plugins] git pull failed (exit code ${code}, ${error.code}):\n${error.details.gitOutput}`);
        return reject(error);
      }

      // Re-validate manifest after update
      const manifestPath = path.join(stageDir, 'manifest.json');
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        cleanupStage();
        return reject(new Error('manifest.json is not valid JSON after update'));
      }

      const validation = validateManifest(manifest);
      if (!validation.valid) {
        cleanupStage();
        return reject(new Error(`Invalid manifest after update: ${validation.error}`));
      }

      if (manifest.name !== name) {
        cleanupStage();
        return reject(new Error(`Updated manifest changed plugin name from "${name}" to "${manifest.name}"`));
      }

      preparePluginDirectory(stageDir, manifest)
        .then(async () => {
          const backupDir = path.join(pluginsDir, `.tmp-bak-${dirName}-${crypto.randomBytes(4).toString('hex')}`);
          try {
            await renameWithRetry(pluginDir, backupDir);
            try {
              await renameWithRetry(stageDir, pluginDir);
            } catch (swapErr) {
              // Restore previous installation before failing
              try { await renameWithRetry(backupDir, pluginDir); } catch { /* best-effort restore */ }
              throw swapErr;
            }
            await rmDirWithRetry(backupDir).catch(() => { /* cleaned on next restart if locked */ });
            resolve(manifest);
          } catch (err) {
            cleanupStage();
            reject(new Error(`Failed to activate updated plugin: ${err.message}`));
          }
        })
        .catch((err) => {
          cleanupStage();
          reject(err);
        });
    });

    gitProcess.on('error', (err) => {
      gitDidNotStart = true;
      cleanupStage();
      console.error('[Plugins] Failed to spawn git pull:', err.message);
      reject(createPluginGitSpawnError('update', err));
    });
  });
}

export async function uninstallPlugin(name, options = {}) {
  const pluginDir = getPluginDir(name);
  if (!pluginDir) {
    throw new Error(`Plugin "${name}" not found`);
  }

  if (scanPlugins().find(plugin => plugin.name === name)?.bundled) {
    throw new Error('Bundled plugins are managed by ClaudeWeb; disable this plugin instead.');
  }

  // On Windows, file handles may be released slightly after process exit.
  // Retry a few times with a short delay before giving up.
  await rmDirWithRetry(pluginDir);

  if (options.removeData === true) {
    const dataDir = getPluginDataDir(name);
    if (fs.existsSync(dataDir)) {
      await rmDirWithRetry(dataDir).catch(() => { /* ignore locked data dir */ });
    }
  }

  // Remove from config and clear any host slot ownership
  const config = getPluginsConfig();
  delete config[name];
  if (config._host?.activeBackgroundPlugin === name) {
    config._host.activeBackgroundPlugin = null;
  }
  if (Array.isArray(config._host?.overlayOrder)) {
    config._host.overlayOrder = config._host.overlayOrder.filter((item) => item !== name);
  }
  savePluginsConfig(config);
}
