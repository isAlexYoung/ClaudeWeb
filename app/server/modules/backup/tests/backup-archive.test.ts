import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';

import {
  BackupDecryptStream,
  BackupEncryptStream,
  ENCRYPTED_HEADER_BYTES,
  classifyBackupEntryPath,
  createEncryptedHeader,
  deriveBackupKey,
  detectBackupFormat,
  parseEncryptedHeader,
} from '@/modules/backup/backup-archive.service.js';
import { AppError } from '@/shared/utils.js';

function collector(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
}

async function encrypt(data: Buffer, password: string): Promise<Buffer> {
  const header = createEncryptedHeader();
  const key = await deriveBackupKey(password, header);
  const chunks: Buffer[] = [];
  await pipeline(Readable.from([data]), new BackupEncryptStream(key, header), collector(chunks));
  return Buffer.concat(chunks);
}

async function decrypt(file: Buffer, password: string): Promise<Buffer> {
  const header = parseEncryptedHeader(file);
  const key = await deriveBackupKey(password, header);
  const chunks: Buffer[] = [];
  await pipeline(Readable.from([file.subarray(ENCRYPTED_HEADER_BYTES)]), new BackupDecryptStream(key, header), collector(chunks));
  return Buffer.concat(chunks);
}

const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

test('entry paths map to their restore area', () => {
  assert.deepEqual(classifyBackupEntryPath('manifest.json'), { kind: 'manifest' });
  assert.deepEqual(classifyBackupEntryPath('cloudcli/data.json'), { kind: 'data' });
  assert.deepEqual(classifyBackupEntryPath('claude/projects/-home-u-p/abc.jsonl'), {
    kind: 'file', area: 'projects', segments: ['-home-u-p', 'abc.jsonl'],
  });
  assert.deepEqual(classifyBackupEntryPath('claude/file-history/abc/v1'), {
    kind: 'file', area: 'fileHistory', segments: ['abc', 'v1'],
  });
  assert.deepEqual(classifyBackupEntryPath('claude/todos/abc-agent-abc.json'), {
    kind: 'file', area: 'todos', segments: ['abc-agent-abc.json'],
  });
  assert.deepEqual(classifyBackupEntryPath('cloudcli/assets/a/b.png'), {
    kind: 'file', area: 'assets', segments: ['a', 'b.png'],
  });
  assert.deepEqual(classifyBackupEntryPath('claude/projects/'), { kind: 'file', area: 'projects', segments: [] });
});

test('unsafe or unknown entry paths are refused', () => {
  for (const unsafe of [
    '/etc/passwd',
    'C:/Windows/evil',
    'claude/projects/../../../etc/passwd',
    'claude/projects/a/../../b',
    'claude/projects/./a',
    'claude/projects//a',
    'claude\\projects\\a',
    'claude/projects/a\0b',
    'claude/.credentials.json',
    'claude/settings.json',
    '.claude.json',
    'cloudcli/auth.db',
    'cloudcli/backup-imports/x.upload',
    `claude/projects/${'x'.repeat(300)}`,
    '',
  ]) {
    assert.throws(() => classifyBackupEntryPath(unsafe), hasCode('BACKUP_UNSAFE_ENTRY'), unsafe);
  }
});

test('encryption round-trips data spanning several frames', async () => {
  const data = Buffer.alloc(2.5 * 1024 * 1024);
  for (let index = 0; index < data.length; index += 1) data[index] = index % 251;
  const file = await encrypt(data, 'correct horse battery');
  assert.equal(detectBackupFormat(file), 'encrypted');
  assert.ok(!file.includes(data.subarray(0, 4096)), 'ciphertext must not contain the plain data');
  assert.ok((await decrypt(file, 'correct horse battery')).equals(data));
});

test('an empty stream still produces a verifiable last frame', async () => {
  const file = await encrypt(Buffer.alloc(0), 'password1');
  assert.equal((await decrypt(file, 'password1')).length, 0);
});

test('a wrong password is reported as such', async () => {
  const file = await encrypt(Buffer.from('secret transcript'), 'password-one');
  await assert.rejects(decrypt(file, 'password-two'), hasCode('BACKUP_PASSWORD_WRONG'));
});

test('truncated, tampered or extended files are refused', async () => {
  const data = Buffer.alloc(1.5 * 1024 * 1024, 7);
  const file = await encrypt(data, 'password1');

  // Cut off the last frame: the remaining frames still authenticate.
  const firstFrameLength = 4 + (file.readUInt32BE(ENCRYPTED_HEADER_BYTES) & 0x7fffffff) + 16;
  const truncated = file.subarray(0, ENCRYPTED_HEADER_BYTES + firstFrameLength);
  await assert.rejects(decrypt(truncated, 'password1'), hasCode('BACKUP_CORRUPTED'));

  const tampered = Buffer.from(file);
  tampered[tampered.length - 40] ^= 0xff;
  await assert.rejects(decrypt(tampered, 'password1'), hasCode('BACKUP_CORRUPTED'));

  const extended = Buffer.concat([file, Buffer.from('trailing')]);
  await assert.rejects(decrypt(extended, 'password1'), hasCode('BACKUP_CORRUPTED'));
});

test('headers asking for an excessive key-derivation cost are refused', () => {
  const header = Buffer.from(createEncryptedHeader().bytes);
  header[10] = 30;
  assert.throws(() => parseEncryptedHeader(header), hasCode('BACKUP_FORMAT_UNKNOWN'));
  assert.equal(detectBackupFormat(Buffer.from('PK\u0003\u0004')), 'unknown');
  assert.equal(detectBackupFormat(Buffer.from([0x1f, 0x8b, 8])), 'plain');
});
