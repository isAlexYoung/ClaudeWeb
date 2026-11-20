import assert from 'node:assert/strict';
import test from 'node:test';

import type { CliEnvironment, CliOutput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { createCliService } from '../cli.service.js';

function createHarness(options: { storedPassword?: string | null; typedPassword?: string } = {}) {
  const logMessages: string[] = [];
  const errorMessages: string[] = [];
  const environment: CliEnvironment = {};
  const output: CliOutput = {
    log: (message = '') => logMessages.push(message),
    error: (message = '') => errorMessages.push(message),
  };
  let serverStarts = 0;
  let storedPassword = options.storedPassword === undefined ? 'current-password' : options.storedPassword;
  const service = createCliService({
    applicationRoot: '/application',
    defaultDatabasePath: '/home/user/.claudeweb/auth.db',
    homeDirectory: '/home/user',
    packageMetadata: {
      version: '1.2.3',
      homepage: 'https://claudeweb.example',
      bugsUrl: 'https://claudeweb.example/issues',
    },
    environment,
    fileSystem: {
      pathExists: () => false,
      getFileStats: () => ({ size: 0, modifiedAt: new Date(0) }),
    },
    output,
    loginPassword: {
      read: () => {
        if (storedPassword === null) {
          throw new AppError('No login password is set yet. Set one with: claudeweb password --set', { code: 'PASSWORD_NOT_SET' });
        }
        return storedPassword;
      },
      write: async (password) => { storedPassword = password; },
      generate: () => 'abcd-efgh-jkmn-pqrs',
      describeUnusable: (password) => (password.length < 8 ? 'The password needs at least 8 characters.' : null),
    },
    readSecretLine: async () => options.typedPassword ?? '',
    startServer: async () => {
      serverStarts += 1;
    },
  });

  return {
    service,
    environment,
    logMessages,
    errorMessages,
    getServerStarts: () => serverStarts,
    getStoredPassword: () => storedPassword,
  };
}

test('applies CLI options to the injected environment before starting the server', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run([
    '--port',
    '8080',
    '--database-path=/data/app.db',
  ]);

  assert.equal(exitCode, 0);
  assert.equal(harness.environment.SERVER_PORT, '8080');
  assert.equal(harness.environment.DATABASE_PATH, '/data/app.db');
  assert.equal(harness.getServerStarts(), 1);
});

test('update only points at the root updater and starts nothing', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 0);
  assert.equal(harness.getServerStarts(), 0);
  assert.match(harness.logMessages.join('\n'), /claudeweb update/);
});

test('password shows the stored password, or explains how to set one', async () => {
  const harness = createHarness();
  assert.equal(await harness.service.run(['password']), 0);
  assert.deepEqual(harness.logMessages, ['current-password']);

  const unset = createHarness({ storedPassword: null });
  assert.equal(await unset.service.run(['password']), 1);
  assert.match(unset.errorMessages[0], /claudeweb password --set/);
  assert.equal(unset.getServerStarts(), 0);
});

test('password --set stores and prints a generated password', async () => {
  const harness = createHarness();

  assert.equal(await harness.service.run(['password', '--set']), 0);

  assert.equal(harness.getStoredPassword(), 'abcd-efgh-jkmn-pqrs');
  assert.match(harness.logMessages.join('\n'), /New login password: abcd-efgh-jkmn-pqrs/);
  assert.match(harness.logMessages.join('\n'), /sign in again/);
});

test('password --set --stdin stores the typed password without printing it, and refuses a short one', async () => {
  const harness = createHarness({ typedPassword: 'my own password' });
  assert.equal(await harness.service.run(['password', '--set', '--stdin']), 0);
  assert.equal(harness.getStoredPassword(), 'my own password');
  assert.equal(harness.logMessages.join('\n').includes('my own password'), false);

  const short = createHarness({ typedPassword: 'short' });
  assert.equal(await short.service.run(['password', '--set', '--stdin']), 1);
  assert.equal(short.getStoredPassword(), 'current-password');
  assert.match(short.errorMessages[0], /at least 8/);
});

test('password rejects options it does not know', async () => {
  const harness = createHarness();
  assert.equal(await harness.service.run(['password', '--reset']), 1);
  assert.match(harness.errorMessages[0], /Usage: claudeweb password/);
  assert.equal(harness.getStoredPassword(), 'current-password');
});

test('returns a failure code for an unknown command without exiting the process', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['unknown']);

  assert.equal(exitCode, 1);
  assert.match(harness.errorMessages[0], /Unknown command: unknown/);
});
