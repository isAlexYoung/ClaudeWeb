import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppError, readObjectRecord } from '@/shared/utils.js';

/**
 * Settings > Your Claude: how Claude addresses the user and the CLI's own
 * memory switches. Everything lives in the Claude config directory the CLI
 * reads (`CLAUDE_CONFIG_DIR`, else ~/.claude), so the CLI, the web terminal
 * and SSH sessions all see the same values:
 *
 * - the name is a marked block in the user-level CLAUDE.md, which every
 *   session loads through the `user` setting source;
 * - `autoMemoryEnabled`, `autoMemoryDirectory` and `autoDreamEnabled` are
 *   keys of the user settings.json, the same keys the CLI's /memory screen
 *   writes. A missing key means the CLI's default;
 * - `outputStyle` is the settings.json key the CLI's /output-style writes:
 *   one of its built-in styles or a style file in `output-styles/`.
 *
 * Every other line of CLAUDE.md and every other settings key is kept as is.
 */

/** An output style the CLI can load: built in, or a Markdown file in the config directory's output-styles/. */
export type OutputStyleOption = { name: string; description: string; builtIn: boolean };

export type YourClaudeSettings = {
  name: string;
  /** null is the CLI's default style. */
  outputStyle: string | null;
  outputStyles: OutputStyleOption[];
  autoMemoryEnabled: boolean | null;
  autoMemoryDirectory: string | null;
  autoDreamEnabled: boolean | null;
  /** `invalid` means settings.json exists but is not a JSON object; it is then never written. */
  settingsStatus: 'ok' | 'missing' | 'invalid';
  settingsPath: string;
  claudeMdPath: string;
};

/** A field left out is unchanged; null removes a settings key so the CLI default applies again. */
export type YourClaudeUpdate = {
  name?: string;
  outputStyle?: string | null;
  autoMemoryEnabled?: boolean | null;
  autoMemoryDirectory?: string | null;
  autoDreamEnabled?: boolean | null;
};

const NAME_START = '<!-- ClaudeWeb: name (managed in Settings > Your Claude) -->';
const NAME_END = '<!-- /ClaudeWeb: name -->';
const MAX_NAME_LENGTH = 60;
const MAX_DIRECTORY_LENGTH = 500;
// The CLI refuses settings files over 2 MB; refuse to grow one past that too.
const MAX_SETTINGS_FILE_BYTES = 2 * 1024 * 1024;

// The CLI's built-in styles besides the default one, by the names its setting uses.
const BUILT_IN_OUTPUT_STYLES: OutputStyleOption[] = [
  { name: 'Explanatory', description: 'Claude explains its implementation choices and codebase patterns', builtIn: true },
  { name: 'Learning', description: 'Claude pauses and asks you to write small pieces of code for hands-on practice', builtIn: true },
  { name: 'Proactive', description: 'Claude executes immediately, minimizes interruptions, and prefers action over planning', builtIn: true },
];
const MAX_STYLE_NAME_LENGTH = 100;

const configDirectory = (): string => {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  return override && path.isAbsolute(override) ? override : path.join(os.homedir(), '.claude');
};

const badRequest = (message: string, code: string) => new AppError(message, { code, statusCode: 400 });

async function readText(filePath: string): Promise<string | null> {
  try {
    const bytes = await readFile(filePath);
    const utf16 = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
    return bytes.toString(utf16 ? 'utf16le' : 'utf8').replace(/^﻿/, '');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

/** Writes beside the target and renames, so the CLI never reads a half-written file; keeps the old mode. */
async function writeAtomically(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const mode = await stat(filePath).then((info) => info.mode & 0o777, () => 0o600);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { mode });
  await chmod(temporary, mode);
  await rename(temporary, filePath);
}

type SettingsFile = { status: 'ok' | 'missing' | 'invalid'; settings: Record<string, unknown> };

async function readSettings(filePath: string): Promise<SettingsFile> {
  const content = await readText(filePath).catch(() => undefined);
  if (content === undefined) return { status: 'invalid', settings: {} };
  if (content === null) return { status: 'missing', settings: {} };
  // The CLI loads an empty file as {}.
  if (!content.trim()) return { status: 'ok', settings: {} };
  try {
    const settings = readObjectRecord(JSON.parse(content));
    return settings ? { status: 'ok', settings } : { status: 'invalid', settings: {} };
  } catch {
    return { status: 'invalid', settings: {} };
  }
}

const blockPattern = () => new RegExp(`\\n*${escapeRegExp(NAME_START)}[\\s\\S]*?${escapeRegExp(NAME_END)}\\n*`);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The name inside the managed block, or '' when there is none. */
export function readNameBlock(claudeMd: string): string {
  const block = claudeMd.match(blockPattern());
  const line = block?.[0].match(/^Address the user as "(.*)"\.$/m);
  return line ? line[1] : '';
}

/** CLAUDE.md with the managed block replaced, added at the top, or removed for an empty name. */
export function writeNameBlock(claudeMd: string, name: string): string {
  const rest = claudeMd.replace(blockPattern(), '\n\n').replace(/^\n+/, '').replace(/\n{3,}$/, '\n');
  if (!name) return rest.trim() ? rest.replace(/\n*$/, '\n') : '';
  const block = `${NAME_START}\nAddress the user as "${name}".\n${NAME_END}\n`;
  return rest.trim() ? `${block}\n${rest.replace(/\n*$/, '\n')}` : block;
}

function normaliseName(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('name must be a string.', 'INVALID_NAME');
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME_LENGTH) throw badRequest(`name is longer than ${MAX_NAME_LENGTH} characters.`, 'INVALID_NAME');
  if (/["<>`]/.test(name)) throw badRequest('name cannot contain quotes, angle brackets or backticks.', 'INVALID_NAME');
  return name;
}

function normaliseDirectory(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest('autoMemoryDirectory must be a string or null.', 'INVALID_DIRECTORY');
  const directory = value.trim();
  if (!directory) return null;
  if (directory.length > MAX_DIRECTORY_LENGTH || /[\r\n\0]/.test(directory)) {
    throw badRequest('autoMemoryDirectory is not a valid path.', 'INVALID_DIRECTORY');
  }
  if (!path.posix.isAbsolute(directory) && !path.isAbsolute(directory) && !directory.startsWith('~/')) {
    throw badRequest('autoMemoryDirectory must be an absolute path or start with ~/.', 'INVALID_DIRECTORY');
  }
  return directory;
}

function normaliseSwitch(value: unknown, key: string): boolean | null {
  if (value === null || typeof value === 'boolean') return value;
  throw badRequest(`${key} must be true, false or null.`, 'INVALID_SWITCH');
}

/** `name` and `description` from a style file's front matter; the file name when it has no name. */
export function readOutputStyleFile(fileName: string, content: string): OutputStyleOption {
  const fields: Record<string, string> = {};
  const frontMatter = content.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  for (const line of frontMatter?.[1].split(/\r?\n/) ?? []) {
    const field = line.match(/^(name|description):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { name: fields.name || fileName.replace(/\.md$/i, ''), description: fields.description ?? '', builtIn: false };
}

async function listOutputStyles(directory: string): Promise<OutputStyleOption[]> {
  const folder = path.join(directory, 'output-styles');
  const files = await readdir(folder).catch(() => [] as string[]);
  const custom = await Promise.all(files.filter((file) => file.toLowerCase().endsWith('.md')).sort().map(async (file) => {
    const content = await readText(path.join(folder, file)).catch(() => null);
    return content === null ? null : readOutputStyleFile(file, content);
  }));
  // A file named like a built-in style, or a second file with the same name, adds nothing the CLI would load.
  const byName = new Map(BUILT_IN_OUTPUT_STYLES.map((style) => [style.name, style]));
  for (const style of custom) {
    if (style && !byName.has(style.name)) byName.set(style.name, style);
  }
  return [...byName.values()];
}

function normaliseOutputStyle(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest('outputStyle must be a string or null.', 'INVALID_OUTPUT_STYLE');
  const style = value.trim();
  if (!style || style === 'default') return null;
  if (style.length > MAX_STYLE_NAME_LENGTH || [...style].some((character) => character.charCodeAt(0) < 0x20)) {
    throw badRequest('outputStyle is not a valid style name.', 'INVALID_OUTPUT_STYLE');
  }
  return style;
}

const readBoolean = (value: unknown) => (typeof value === 'boolean' ? value : null);
const readString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

export const yourClaudeService = {
  async read(): Promise<YourClaudeSettings> {
    const directory = configDirectory();
    const settingsPath = path.join(directory, 'settings.json');
    const claudeMdPath = path.join(directory, 'CLAUDE.md');
    const [{ status, settings }, claudeMd, outputStyles] = await Promise.all([
      readSettings(settingsPath),
      readText(claudeMdPath).catch(() => null),
      listOutputStyles(directory),
    ]);
    const outputStyle = readString(settings.outputStyle);
    return {
      name: readNameBlock(claudeMd ?? ''),
      outputStyle: outputStyle === 'default' ? null : outputStyle,
      outputStyles,
      autoMemoryEnabled: readBoolean(settings.autoMemoryEnabled),
      autoMemoryDirectory: readString(settings.autoMemoryDirectory),
      autoDreamEnabled: readBoolean(settings.autoDreamEnabled),
      settingsStatus: status,
      settingsPath,
      claudeMdPath,
    };
  },

  async update(input: unknown): Promise<YourClaudeSettings> {
    const update = readObjectRecord(input);
    if (!update) throw badRequest('Request body must be an object.', 'INVALID_BODY');
    const directory = configDirectory();

    const settingKeys = ['autoMemoryEnabled', 'autoMemoryDirectory', 'autoDreamEnabled', 'outputStyle'] as const;
    const changes = new Map<string, unknown>();
    for (const key of settingKeys) {
      if (!(key in update)) continue;
      if (key === 'autoMemoryDirectory') changes.set(key, normaliseDirectory(update[key]));
      else if (key === 'outputStyle') changes.set(key, normaliseOutputStyle(update[key]));
      else changes.set(key, normaliseSwitch(update[key], key));
    }
    const name = 'name' in update ? normaliseName(update.name) : undefined;

    if (changes.size > 0) {
      const settingsPath = path.join(directory, 'settings.json');
      const { status, settings } = await readSettings(settingsPath);
      if (status === 'invalid') {
        throw new AppError(`${settingsPath} is not valid JSON, so it was not changed. Fix or remove it first.`, {
          code: 'SETTINGS_FILE_INVALID',
          statusCode: 409,
        });
      }
      for (const [key, value] of changes) {
        if (value === null) delete settings[key];
        else settings[key] = value;
      }
      const content = `${JSON.stringify(settings, null, 2)}\n`;
      if (Buffer.byteLength(content) > MAX_SETTINGS_FILE_BYTES) {
        throw new AppError('settings.json would exceed the 2 MB the CLI loads.', { code: 'SETTINGS_FILE_TOO_LARGE', statusCode: 409 });
      }
      await writeAtomically(settingsPath, content);
    }

    if (name !== undefined) {
      const claudeMdPath = path.join(directory, 'CLAUDE.md');
      const current = (await readText(claudeMdPath)) ?? '';
      const next = writeNameBlock(current, name);
      if (next !== current) await writeAtomically(claudeMdPath, next);
    }

    return this.read();
  },
};
