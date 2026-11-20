import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { LoginPasswordFiles } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

// The one login password of a ClaudeWeb server lives in two files under
// /etc/claudeweb, both written by root (the installer and `claudeweb password`):
// - login.json, readable by the service account, holds only a scrypt hash and a
//   random "generation" that changes with every new password;
// - password, readable by root alone, holds the password itself so root can
//   look it up again. The threat model excludes an attacker who already has root.
const DEFAULT_LOGIN_FILE = '/etc/claudeweb/login.json';
const DEFAULT_PASSWORD_FILE = '/etc/claudeweb/password';

const SCRYPT_COST = 32768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_KEY_LENGTH = 32;
// N=32768, r=8 needs 32 MiB, exactly Node's default limit, so allow a little more.
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

// No 0/O, 1/l/I: generated passwords are read off a terminal and typed by hand.
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GENERATED_GROUPS = 4;
const GENERATED_GROUP_LENGTH = 4;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

type LoginRecord = {
  version: 1;
  scheme: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
  generation: string;
};

/** Used by Auth and the CLI to find the password files for this process. */
export function getLoginPasswordFiles(environment: NodeJS.ProcessEnv = process.env): LoginPasswordFiles {
  return {
    loginFile: environment.CLAUDEWEB_LOGIN_FILE || DEFAULT_LOGIN_FILE,
    passwordFile: environment.CLAUDEWEB_PASSWORD_FILE || DEFAULT_PASSWORD_FILE,
  };
}

function isLoginRecord(value: unknown): value is LoginRecord {
  const record = value as Partial<LoginRecord> | null;
  return Boolean(record)
    && record?.version === 1
    && record.scheme === 'scrypt'
    && Number.isInteger(record.N) && Number.isInteger(record.r) && Number.isInteger(record.p)
    && typeof record.salt === 'string' && record.salt.length > 0
    && typeof record.hash === 'string' && record.hash.length > 0
    && typeof record.generation === 'string' && record.generation.length > 0;
}

function deriveKey(password: string, salt: Buffer, cost: number, blockSize: number, parallelism: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: cost, r: blockSize, p: parallelism, maxmem: SCRYPT_MAX_MEMORY,
    }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

let cachedRecord: { file: string; mtimeMs: number; size: number; record: LoginRecord | null } | null = null;

/**
 * Reads login.json, re-reading only when the file changed, so every request
 * can ask for the current generation without parsing JSON each time. Returns
 * null when no password is set or the file is unreadable or malformed.
 */
function readLoginRecord(loginFile: string): LoginRecord | null {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(loginFile);
  } catch {
    cachedRecord = null;
    return null;
  }
  if (cachedRecord && cachedRecord.file === loginFile
    && cachedRecord.mtimeMs === stats.mtimeMs && cachedRecord.size === stats.size) {
    return cachedRecord.record;
  }
  let record: LoginRecord | null = null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(loginFile, 'utf8'));
    record = isLoginRecord(parsed) ? parsed : null;
    if (!record) console.error(`[Auth] ${loginFile} is not a valid login password file`);
  } catch (error) {
    console.error(`[Auth] Cannot read ${loginFile}:`, error instanceof Error ? error.message : String(error));
  }
  cachedRecord = { file: loginFile, mtimeMs: stats.mtimeMs, size: stats.size, record };
  return record;
}

/**
 * Used by Auth on every authenticated request: the generation sessions are
 * created under, or null when no password is set. A session holding another
 * generation belongs to an earlier password and is over.
 */
export function getLoginPasswordGeneration(files: LoginPasswordFiles = getLoginPasswordFiles()): string | null {
  return readLoginRecord(files.loginFile)?.generation ?? null;
}

/**
 * Used by Auth's login. Resolves to null when no password is set, otherwise to
 * whether the password matches and the generation it belongs to.
 */
export async function verifyLoginPassword(
  password: string,
  files: LoginPasswordFiles = getLoginPasswordFiles(),
): Promise<{ matches: boolean; generation: string } | null> {
  const record = readLoginRecord(files.loginFile);
  if (!record) return null;
  const expected = Buffer.from(record.hash, 'base64');
  const actual = await deriveKey(password, Buffer.from(record.salt, 'base64'), record.N, record.r, record.p);
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
  return { matches, generation: record.generation };
}

/** Used by the CLI `password --set` when no password is supplied: 4 groups of 4, about 92 bits. */
export function generateLoginPassword(): string {
  const groups: string[] = [];
  for (let group = 0; group < GENERATED_GROUPS; group += 1) {
    let text = '';
    for (let index = 0; index < GENERATED_GROUP_LENGTH; index += 1) {
      text += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    groups.push(text);
  }
  return groups.join('-');
}

/**
 * Used by the CLI `password --set` to check a chosen password before writing it.
 * Returns an English reason when the password cannot be used, otherwise null.
 */
export function describeUnusablePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(password)) return 'The password cannot contain line breaks or control characters.';
  if (password.trim() !== password) return 'The password cannot start or end with a space.';
  return null;
}

/**
 * Writes `content` next to `target` and renames it into place, so a reader
 * never sees half a file. When root writes, the new file takes the
 * directory's group: in /etc/claudeweb (root:claudeweb) the service account
 * can then read login.json, while the 0600 password file stays root's.
 */
function writeFileAtomically(target: string, content: string, mode: number): void {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
  const temporary = path.join(directory, `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = fs.openSync(temporary, 'wx', mode);
  try {
    fs.writeSync(handle, content);
    fs.fsyncSync(handle);
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      fs.fchownSync(handle, 0, fs.statSync(directory).gid);
    }
    fs.fchmodSync(handle, mode);
    fs.closeSync(handle);
  } catch (error) {
    fs.closeSync(handle);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  fs.renameSync(temporary, target);
}

/**
 * Used by the CLI `password --set` (run by root, also from the installer):
 * stores a new password in both files. The new generation signs out every
 * device at its next request.
 */
export async function writeLoginPassword(
  password: string,
  files: LoginPasswordFiles = getLoginPasswordFiles(),
): Promise<void> {
  const problem = describeUnusablePassword(password);
  if (problem) {
    throw new AppError(problem, { code: 'PASSWORD_UNUSABLE', statusCode: 400 });
  }
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELISM);
  const record: LoginRecord = {
    version: 1,
    scheme: 'scrypt',
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    salt: salt.toString('base64'),
    hash: key.toString('base64'),
    generation: randomBytes(16).toString('hex'),
  };
  // login.json decides which password works, so it is written first. If the
  // copy for root then fails, the caller still has the new password to show.
  writeFileAtomically(files.loginFile, `${JSON.stringify(record, null, 2)}\n`, 0o640);
  try {
    writeFileAtomically(files.passwordFile, `${password}\n`, 0o600);
  } catch (error) {
    throw new AppError(
      `The new password is active, but saving the copy for root failed: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'PASSWORD_COPY_FAILED', statusCode: 500 },
    );
  }
}

/** Used by the CLI `password` command to show root the current password. */
export function readStoredLoginPassword(files: LoginPasswordFiles = getLoginPasswordFiles()): string {
  let text: string;
  try {
    text = fs.readFileSync(files.passwordFile, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new AppError('No login password is set yet. Set one with: claudeweb password --set', {
        code: 'PASSWORD_NOT_SET', statusCode: 404,
      });
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new AppError('Only root can read the login password. Run this command as root.', {
        code: 'PASSWORD_NEEDS_ROOT', statusCode: 403,
      });
    }
    throw error;
  }
  return text.replace(/\r?\n$/, '');
}
