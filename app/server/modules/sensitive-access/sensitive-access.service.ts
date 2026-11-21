import os from 'node:os';
import { posix as path } from 'node:path';

/**
 * The one list of the user's sensitive information on this server, and the
 * check Claude's tool calls go through before they run (the Claude runtime's
 * PreToolUse hook). A call that would read or send one of these asks the user
 * first. The check only sees what a tool call names: a program the user or
 * Claude starts may still read these files, as they belong to the same user.
 */

/** What a match is about; the page words each kind. */
export type SensitiveKind = 'claudeCredentials' | 'browserData' | 'claudewebData' | 'claudewebSettings' | 'signingKey';

type Entry = {
  kind: SensitiveKind;
  /** Files or folders; anything inside a folder counts. */
  paths: string[];
  /** Fragments that name them in a command line or a search pattern. */
  names: string[];
};

export function sensitiveEntries(home = os.homedir(), databasePath = process.env.DATABASE_PATH): Entry[] {
  const dataDirectories = [path.join(home, '.claudeweb'), '/var/lib/claudeweb'];
  if (databasePath) dataDirectories.push(path.dirname(path.resolve(databasePath)));
  return [
    { kind: 'claudeCredentials', paths: [path.join(home, '.claude', '.credentials.json')], names: ['.credentials.json'] },
    { kind: 'browserData', paths: [path.join(home, '.config', 'claudeweb-browser')], names: ['.config/claudeweb-browser'] },
    { kind: 'claudewebData', paths: [...new Set(dataDirectories)], names: ['/var/lib/claudeweb', '.claudeweb/', 'auth.db'] },
    { kind: 'claudewebSettings', paths: ['/etc/claudeweb'], names: ['/etc/claudeweb'] },
    { kind: 'signingKey', paths: [path.join(home, '.claudeweb-signing')], names: ['.claudeweb-signing', 'minisign.key'] },
  ];
}

// The input fields that name what a tool reads, searches or runs; a file's new
// content (Write's `content`, Edit's strings) is not looked at.
const PATH_FIELDS = ['file_path', 'notebook_path', 'path', 'paths'];
const TEXT_FIELDS = ['command', 'pattern', 'glob'];

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function inside(candidate: string, root: string) {
  return candidate === root || candidate.startsWith(root.endsWith('/') ? root : `${root}/`);
}

/**
 * The kinds of sensitive information a tool call names, or an empty list.
 * Paths are resolved against the session's folder and `~`; command lines
 * and patterns are searched for the names in the list.
 */
export function findSensitiveAccess(input: unknown, { cwd, home = os.homedir(), entries = sensitiveEntries(home) }: { cwd: string; home?: string; entries?: Entry[] }): SensitiveKind[] {
  if (!input || typeof input !== 'object') return [];
  const fields = input as Record<string, unknown>;
  const found = new Set<SensitiveKind>();
  const expand = (value: string) => (value === '~' || value.startsWith('~/') ? path.join(home, value.slice(1)) : value);

  for (const key of PATH_FIELDS) {
    for (const value of strings(fields[key])) {
      const resolved = path.resolve(cwd, expand(value));
      for (const entry of entries) {
        if (entry.paths.some((root) => inside(resolved, root))) found.add(entry.kind);
      }
    }
  }
  for (const key of TEXT_FIELDS) {
    for (const value of strings(fields[key])) {
      const text = value.replace(/\$HOME|\$\{HOME\}|~(?=\/)/g, home);
      for (const entry of entries) {
        if (entry.names.some((name) => text.includes(name)) || entry.paths.some((root) => text.includes(root))) found.add(entry.kind);
      }
    }
  }
  return [...found];
}
