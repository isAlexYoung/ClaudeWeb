import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

import { Header, Pax } from 'tar';

import { AppError } from '@/shared/utils.js';

// ---------------------------------------------------------------------------
// Archive layout
// ---------------------------------------------------------------------------
//
// A backup is a gzip-compressed tar file. Without a password that is the whole
// file, so 7-Zip, Windows Explorer or `tar` can open it. With a password the
// same bytes are wrapped in the frame format below, which only this importer
// reads.
//
// Inside the tar, every entry sits under one of a fixed set of prefixes and is
// written back only under the matching directory of the importing account:
//
//   manifest.json                    format marker, written first
//   claudeweb/data.json               ClaudeWeb rows (titles, archive flags, ...)
//   claude/projects/<dir>/...        transcripts and per-project memory
//   claude/file-history/<sid>/...    code checkpoints used by rewind
//   claude/todos/<file>              task lists
//   claudeweb/assets/...              images attached to chats
//   files/<path under home>/...      project folders chosen at export (optional)
//
// Paths are recorded as they were on the exporting server; an import onto a
// server with another home folder moves everything under the old home to the
// new one (manifest `sourceHome`).

/** Name of the first entry; its `format` field identifies a ClaudeWeb backup. */
export const BACKUP_MANIFEST_ENTRY = 'manifest.json';
/** Entry holding the exported ClaudeWeb database rows. */
export const BACKUP_DATA_ENTRY = 'claudeweb/data.json';
/** Value of `manifest.format` for this backup type. */
export const BACKUP_FORMAT_NAME = 'claudeweb-backup';
/** Earlier ClaudeWeb releases wrote this format name and kept their rows and images under `cloudcli/`; those backups still import. */
export const LEGACY_BACKUP_FORMAT_NAME = 'cloudcli-backup';
const LEGACY_ROOT = 'cloudcli';
/** Version of the manifest and data layout this build writes and reads. */
export const BACKUP_FORMAT_VERSION = 1;

/** The restorable areas, in the order the exporter writes them. */
export const BACKUP_AREAS = [
  { area: 'projects', prefix: 'claude/projects/' },
  { area: 'fileHistory', prefix: 'claude/file-history/' },
  { area: 'todos', prefix: 'claude/todos/' },
  { area: 'assets', prefix: 'claudeweb/assets/' },
  { area: 'workspace', prefix: 'files/' },
] as const;

/** One of the restorable directories. */
export type BackupArea = (typeof BACKUP_AREAS)[number]['area'];

/** Where a validated archive entry goes; `segments` is empty for an area or parent directory itself. */
export type BackupEntryTarget =
  | { kind: 'manifest' }
  | { kind: 'data' }
  | { kind: 'file'; area: BackupArea; segments: string[] };

const TAR_BLOCK_BYTES = 512;
const MAX_ENTRY_PATH_LENGTH = 4096;
const MAX_SEGMENT_BYTES = 255;

function unsafeEntry(entryPath: string, reason: string): AppError {
  return new AppError(`The backup contains an entry that cannot be restored safely (${reason}): ${entryPath.slice(0, 200)}`, {
    code: 'BACKUP_UNSAFE_ENTRY',
    statusCode: 400,
  });
}

/**
 * Validates one archive entry path and maps it to its restore area.
 *
 * Rejected, so the whole archive is refused: absolute paths, drive letters,
 * backslashes, NUL bytes, empty, `.` and `..` segments, over-long names and
 * anything outside the known prefixes. Callers still create directories and
 * files without following symlinks; this check only keeps names inside the
 * area they claim.
 */
export function classifyBackupEntryPath(entryPath: string): BackupEntryTarget {
  if (typeof entryPath !== 'string' || entryPath.length === 0 || entryPath.length > MAX_ENTRY_PATH_LENGTH) {
    throw unsafeEntry(String(entryPath), 'path length');
  }
  if (entryPath.includes('\0') || entryPath.includes('\\')) {
    throw unsafeEntry(entryPath, 'forbidden character');
  }
  if (entryPath.startsWith('/') || /^[A-Za-z]:/.test(entryPath)) {
    throw unsafeEntry(entryPath, 'absolute path');
  }

  // Directory entries end in "/"; the trailing empty segment is not a name.
  const trimmed = entryPath.endsWith('/') ? entryPath.slice(0, -1) : entryPath;
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw unsafeEntry(entryPath, 'relative segment');
    }
    if (Buffer.byteLength(segment) > MAX_SEGMENT_BYTES) {
      throw unsafeEntry(entryPath, 'name too long');
    }
    // A colon would name an NTFS stream on Windows test machines; Claude never writes one.
    if (process.platform === 'win32' && segment.includes(':')) {
      throw unsafeEntry(entryPath, 'forbidden character');
    }
  }

  // A backup from an earlier release names the ClaudeWeb directory `cloudcli/`.
  const current = trimmed === LEGACY_ROOT || trimmed.startsWith(LEGACY_ROOT + '/') ? 'claudeweb' + trimmed.slice(LEGACY_ROOT.length) : trimmed;

  if (current === BACKUP_MANIFEST_ENTRY) return { kind: 'manifest' };
  if (current === BACKUP_DATA_ENTRY) return { kind: 'data' };

  for (const { area, prefix } of BACKUP_AREAS) {
    if (current === prefix.slice(0, -1)) {
      return { kind: 'file', area, segments: [] };
    }
    if (current.startsWith(prefix)) {
      const segments = current.slice(prefix.length).split('/');
      // Project files go under the home folder, but never into its hidden
      // folders (shell start-up files, SSH keys, Claude's own settings).
      if (area === 'workspace' && segments[0].startsWith('.')) throw unsafeEntry(entryPath, 'hidden folder in the home folder');
      return { kind: 'file', area, segments };
    }
  }

  // The parent directories of the areas are harmless directory entries.
  if (current === 'claude' || current === 'claudeweb') {
    return { kind: 'file', area: 'projects', segments: [] };
  }

  throw unsafeEntry(entryPath, 'unknown location');
}

/**
 * Tar header (plus a pax header when the path or size does not fit ustar) for
 * one regular file.
 *
 * The modification time is whole seconds, rounded down, and deliberately not
 * carried at pax precision: a restored transcript must never look newer than
 * the session row restored with it, or the indexer would treat it as new
 * activity and un-archive the conversation.
 */
export function encodeTarFileHeader(entryPath: string, size: number, modifiedAt: Date, mode = 0o600): Buffer {
  const mtime = new Date(Math.floor(modifiedAt.getTime() / 1000) * 1000);
  const header = new Header({
    path: entryPath,
    mode,
    uid: 0,
    gid: 0,
    size,
    mtime,
    type: 'File',
    uname: '',
    gname: '',
  });
  const needPax = header.encode();
  const block = Buffer.from(header.block as Buffer);
  if (!needPax) {
    return block;
  }

  const pax = new Pax({ path: entryPath, size }).encode();
  return Buffer.concat([pax, block]);
}

/** Zero bytes that pad a file body to the next tar block. */
export function tarPadding(size: number): Buffer {
  const remainder = size % TAR_BLOCK_BYTES;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(TAR_BLOCK_BYTES - remainder);
}

/** The two zero blocks that end a tar archive. */
export const TAR_END_OF_ARCHIVE = Buffer.alloc(TAR_BLOCK_BYTES * 2);

// ---------------------------------------------------------------------------
// Password encryption
// ---------------------------------------------------------------------------
//
// Header (44 bytes): "CCBKENC1" | version 1 | kdf 1 (scrypt) | log2(N) | r | p |
// 3 reserved | 16-byte salt | 8-byte nonce prefix | u32 frame size.
// Then frames: u32 (bit 31 = last frame, low bits = length) | AES-256-GCM
// ciphertext | 16-byte tag. Frame n uses nonce = prefix || u32 n and the
// header, n and the last-frame flag as associated data, so frames cannot be
// reordered, dropped or cut off without the import failing.

const ENCRYPTED_MAGIC = Buffer.from('CCBKENC1', 'ascii');
/** Length of the encryption header at the start of a password-protected backup. */
export const ENCRYPTED_HEADER_BYTES = 44;
const ENCRYPTION_VERSION = 1;
const KDF_SCRYPT = 1;
const DEFAULT_SCRYPT = { log2N: 15, r: 8, p: 1 } as const;
const FRAME_BYTES = 1024 * 1024;
const LAST_FRAME_FLAG = 0x80000000;
const GCM_TAG_BYTES = 16;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

/** Minimum password length accepted for an encrypted backup. */
export const BACKUP_PASSWORD_MIN_LENGTH = 8;
/** Maximum password length; longer input is refused rather than hashed. */
export const BACKUP_PASSWORD_MAX_LENGTH = 1024;

type ScryptParameters = { log2N: number; r: number; p: number };

/** Parsed encryption header, kept with the derived key between preview and import. */
export type EncryptedBackupHeader = {
  bytes: Buffer;
  scrypt: ScryptParameters;
  salt: Buffer;
  noncePrefix: Buffer;
  frameBytes: number;
};

/** Identifies a backup from its first bytes. */
export function detectBackupFormat(firstBytes: Buffer): 'plain' | 'encrypted' | 'unknown' {
  if (firstBytes.length >= ENCRYPTED_MAGIC.length && firstBytes.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)) {
    return 'encrypted';
  }
  if (firstBytes.length >= 2 && firstBytes.subarray(0, 2).equals(GZIP_MAGIC)) {
    return 'plain';
  }
  return 'unknown';
}

function formatError(message: string): AppError {
  return new AppError(message, { code: 'BACKUP_FORMAT_UNKNOWN', statusCode: 400 });
}

/**
 * Reads and range-checks an encryption header. The scrypt cost is bounded so
 * a crafted file cannot make the server spend minutes or gigabytes deriving
 * a key.
 */
export function parseEncryptedHeader(bytes: Buffer): EncryptedBackupHeader {
  if (bytes.length < ENCRYPTED_HEADER_BYTES || detectBackupFormat(bytes) !== 'encrypted') {
    throw formatError('Not an encrypted ClaudeWeb backup');
  }
  const header = Buffer.from(bytes.subarray(0, ENCRYPTED_HEADER_BYTES));
  const scryptParameters = { log2N: header[10], r: header[11], p: header[12] };
  const frameBytes = header.readUInt32BE(40);
  if (header[8] !== ENCRYPTION_VERSION || header[9] !== KDF_SCRYPT) {
    throw formatError('Unsupported backup encryption version');
  }
  if (scryptParameters.log2N < 14 || scryptParameters.log2N > 20
    || scryptParameters.r < 1 || scryptParameters.r > 16
    || scryptParameters.p < 1 || scryptParameters.p > 4
    || frameBytes < 1024 || frameBytes > 16 * 1024 * 1024) {
    throw formatError('Unsupported backup encryption parameters');
  }
  return {
    bytes: header,
    scrypt: scryptParameters,
    salt: Buffer.from(header.subarray(16, 32)),
    noncePrefix: Buffer.from(header.subarray(32, 40)),
    frameBytes,
  };
}

/** Derives the AES-256 key for one backup from its password and header. */
export function deriveBackupKey(password: string, header: EncryptedBackupHeader): Promise<Buffer> {
  const { log2N, r, p } = header.scrypt;
  const cost = 2 ** log2N;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), header.salt, 32, { N: cost, r, p, maxmem: 256 * cost * r + 32 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function frameNonce(noncePrefix: Buffer, index: number): Buffer {
  const nonce = Buffer.alloc(12);
  noncePrefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, 8);
  return nonce;
}

function frameAad(header: Buffer, index: number, last: boolean): Buffer {
  const aad = Buffer.alloc(header.length + 5);
  header.copy(aad, 0);
  aad.writeUInt32BE(index, header.length);
  aad[header.length + 4] = last ? 1 : 0;
  return aad;
}

/** Creates a fresh encryption header with a random salt and nonce prefix. */
export function createEncryptedHeader(): EncryptedBackupHeader {
  const bytes = Buffer.alloc(ENCRYPTED_HEADER_BYTES);
  ENCRYPTED_MAGIC.copy(bytes, 0);
  bytes[8] = ENCRYPTION_VERSION;
  bytes[9] = KDF_SCRYPT;
  bytes[10] = DEFAULT_SCRYPT.log2N;
  bytes[11] = DEFAULT_SCRYPT.r;
  bytes[12] = DEFAULT_SCRYPT.p;
  randomBytes(16).copy(bytes, 16);
  randomBytes(8).copy(bytes, 32);
  bytes.writeUInt32BE(FRAME_BYTES, 40);
  return parseEncryptedHeader(bytes);
}

/** Encrypts a byte stream into the frame format, header first. */
export class BackupEncryptStream extends Transform {
  readonly #key: Buffer;
  readonly #header: EncryptedBackupHeader;
  #pending: Buffer[] = [];
  #pendingBytes = 0;
  #index = 0;
  #headerWritten = false;

  constructor(key: Buffer, header: EncryptedBackupHeader) {
    super();
    this.#key = key;
    this.#header = header;
  }

  #writeHeader(): void {
    if (!this.#headerWritten) {
      this.push(this.#header.bytes);
      this.#headerWritten = true;
    }
  }

  #take(length: number): Buffer {
    const all = Buffer.concat(this.#pending, this.#pendingBytes);
    const rest = all.subarray(length);
    this.#pending = rest.length > 0 ? [rest] : [];
    this.#pendingBytes = rest.length;
    return all.subarray(0, length);
  }

  #pushFrame(plain: Buffer, last: boolean): void {
    const cipher = createCipheriv('aes-256-gcm', this.#key, frameNonce(this.#header.noncePrefix, this.#index));
    cipher.setAAD(frameAad(this.#header.bytes, this.#index, last));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE((last ? LAST_FRAME_FLAG : 0) + encrypted.length, 0);
    this.push(Buffer.concat([length, encrypted, cipher.getAuthTag()]));
    this.#index += 1;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#writeHeader();
    this.#pending.push(chunk);
    this.#pendingBytes += chunk.length;
    while (this.#pendingBytes >= this.#header.frameBytes) {
      this.#pushFrame(this.#take(this.#header.frameBytes), false);
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    this.#writeHeader();
    this.#pushFrame(this.#take(this.#pendingBytes), true);
    callback();
  }
}

/**
 * Decrypts the frames that follow the header. Fails with
 * BACKUP_PASSWORD_WRONG when the first frame does not authenticate, and with
 * BACKUP_CORRUPTED for a later bad frame, a missing last frame or trailing data.
 */
export class BackupDecryptStream extends Transform {
  readonly #key: Buffer;
  readonly #header: EncryptedBackupHeader;
  #buffer: Buffer = Buffer.alloc(0);
  #index = 0;
  #sawLastFrame = false;

  constructor(key: Buffer, header: EncryptedBackupHeader) {
    super();
    this.#key = key;
    this.#header = header;
  }

  #error(wrongPassword: boolean): AppError {
    return wrongPassword
      ? new AppError('The password is not correct for this backup', { code: 'BACKUP_PASSWORD_WRONG', statusCode: 400 })
      : new AppError('The backup file is damaged or incomplete', { code: 'BACKUP_CORRUPTED', statusCode: 400 });
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      if (this.#sawLastFrame) {
        callback(this.#error(false));
        return;
      }
      const word = this.#buffer.readUInt32BE(0);
      const last = (word & LAST_FRAME_FLAG) !== 0;
      const length = word & ~LAST_FRAME_FLAG;
      if (length > this.#header.frameBytes) {
        callback(this.#error(this.#index === 0));
        return;
      }
      const frameEnd = 4 + length + GCM_TAG_BYTES;
      if (this.#buffer.length < frameEnd) {
        break;
      }
      let plain: Buffer;
      try {
        const decipher = createDecipheriv('aes-256-gcm', this.#key, frameNonce(this.#header.noncePrefix, this.#index));
        decipher.setAAD(frameAad(this.#header.bytes, this.#index, last));
        decipher.setAuthTag(this.#buffer.subarray(4 + length, frameEnd));
        plain = Buffer.concat([decipher.update(this.#buffer.subarray(4, 4 + length)), decipher.final()]);
      } catch {
        callback(this.#error(this.#index === 0));
        return;
      }
      if (plain.length > 0) this.push(plain);
      this.#buffer = this.#buffer.subarray(frameEnd);
      this.#index += 1;
      this.#sawLastFrame = last;
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    if (!this.#sawLastFrame || this.#buffer.length > 0) {
      callback(this.#error(false));
      return;
    }
    callback();
  }
}
