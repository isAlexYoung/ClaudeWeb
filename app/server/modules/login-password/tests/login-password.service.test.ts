import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  describeUnusablePassword,
  generateLoginPassword,
  getLoginPasswordFiles,
  getLoginPasswordGeneration,
  readStoredLoginPassword,
  verifyLoginPassword,
  writeLoginPassword,
} from '../index.js';

async function withFiles(run: (files: { loginFile: string; passwordFile: string }) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'claudeweb-login-'));
  try {
    await run({ loginFile: path.join(directory, 'etc', 'login.json'), passwordFile: path.join(directory, 'etc', 'password') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('a written password verifies, a wrong one does not, and root can read it back', async () => {
  await withFiles(async (files) => {
    assert.equal(await verifyLoginPassword('anything', files), null, 'no password set yet');
    assert.equal(getLoginPasswordGeneration(files), null);

    await writeLoginPassword('correct horse 1', files);

    assert.equal((await verifyLoginPassword('correct horse 1', files))?.matches, true);
    assert.equal((await verifyLoginPassword('correct horse 2', files))?.matches, false);
    assert.equal(readStoredLoginPassword(files), 'correct horse 1');
    const record = JSON.parse(await readFile(files.loginFile, 'utf8')) as Record<string, unknown>;
    assert.equal(JSON.stringify(record).includes('correct horse'), false, 'login.json holds no plain password');
    if (process.platform !== 'win32') {
      assert.equal((await stat(files.passwordFile)).mode & 0o777, 0o600);
      assert.equal((await stat(files.loginFile)).mode & 0o777, 0o640);
    }
  });
});

test('every new password has a new generation, so old sessions end', async () => {
  await withFiles(async (files) => {
    await writeLoginPassword('first-password', files);
    const first = getLoginPasswordGeneration(files);
    await writeLoginPassword('first-password', files);
    const second = getLoginPasswordGeneration(files);
    assert.ok(first && second);
    assert.notEqual(first, second);
  });
});

test('a damaged login.json counts as no password rather than letting anyone in', async () => {
  await withFiles(async (files) => {
    await writeLoginPassword('first-password', files);
    await writeFile(files.loginFile, '{"version":1,"scheme":"scrypt"}');
    assert.equal(await verifyLoginPassword('first-password', files), null);
    assert.equal(getLoginPasswordGeneration(files), null);
  });
});

test('reading the password when none is set explains how to set one', async () => {
  await withFiles(async (files) => {
    assert.throws(() => readStoredLoginPassword(files), /claudeweb password --set/);
  });
});

test('generated passwords are four groups of four unambiguous characters', () => {
  const password = generateLoginPassword();
  assert.match(password, /^[a-km-zA-HJ-NP-Z2-9]{4}(-[a-km-zA-HJ-NP-Z2-9]{4}){3}$/);
  assert.notEqual(generateLoginPassword(), password);
  assert.equal(describeUnusablePassword(password), null);
});

test('chosen passwords must be long enough and free of control characters and edge spaces', () => {
  assert.match(describeUnusablePassword('short') ?? '', /at least 8/);
  assert.match(describeUnusablePassword('line\nbreak!') ?? '', /control/);
  assert.match(describeUnusablePassword(' padded-password ') ?? '', /space/);
  assert.equal(describeUnusablePassword('a fine password'), null);
});

test('the file locations default to /etc/claudeweb and follow the environment', () => {
  assert.deepEqual(getLoginPasswordFiles({}), {
    loginFile: '/etc/claudeweb/login.json',
    passwordFile: '/etc/claudeweb/password',
  });
  assert.deepEqual(getLoginPasswordFiles({ CLAUDEWEB_LOGIN_FILE: '/x/l.json', CLAUDEWEB_PASSWORD_FILE: '/x/p' }), {
    loginFile: '/x/l.json',
    passwordFile: '/x/p',
  });
});
