import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { artefactsService } from '@/modules/artefacts/services/artefacts.service.js';
import { SHEET_FORMAT, validateSheetDocument } from '@/modules/artefacts/sheet-format.js';
import { closeConnection, initializeDatabase, sessionsDb, userDb } from '@/modules/database/index.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

type RunCall = { provider: string; command: string; options: Record<string, unknown> };

async function withArtefacts(runTest: (userId: number, directory: string) => void | Promise<void>): Promise<void> {
  const previous = {
    database: process.env.DATABASE_PATH,
    directory: process.env.CLAUDEWEB_ARTEFACTS_DIR,
    workspace: process.env.CLAUDEWEB_ARTEFACTS_WORKSPACE,
  };
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'artefacts-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.CLAUDEWEB_ARTEFACTS_DIR = path.join(tempDirectory, 'Artefacts');
  process.env.CLAUDEWEB_ARTEFACTS_WORKSPACE = tempDirectory;
  await initializeDatabase();
  try {
    const user = userDb.createUser('artefacts', 'hash');
    await runTest(Number(user.id), process.env.CLAUDEWEB_ARTEFACTS_DIR);
  } finally {
    chatRunRegistry.clearAll();
    connectedClients.clear();
    closeConnection();
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('DATABASE_PATH', previous.database);
    restore('CLAUDEWEB_ARTEFACTS_DIR', previous.directory);
    restore('CLAUDEWEB_ARTEFACTS_WORKSPACE', previous.workspace);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function createRuntime(runs: RunCall[], onRun?: (call: RunCall) => void) {
  return {
    hasRuntime: () => true,
    hasBackgroundWork: () => false,
    run: async (provider: string, command: string, options: Record<string, unknown>) => {
      const call = { provider, command, options };
      runs.push(call);
      onRun?.(call);
    },
    abort: async () => true,
  } as never;
}

async function waitForIdle(userId: number, id: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!artefactsService.state(userId, id).running) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The run did not finish.');
}

function expectAppError(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof AppError && error.code === code);
}

const sheet = (cells: Record<string, string | number | boolean | null>) => ({
  format: SHEET_FORMAT,
  sheets: [{ name: 'Sheet1', cells }],
});

test('a new spreadsheet is an empty sheet on disk, listed and opened with its revision', async () => {
  await withArtefacts((userId, directory) => {
    const created = artefactsService.create(userId, { kind: 'sheet', title: '预算' });
    assert.equal(created.title, '预算');
    assert.equal(created.kind, 'sheet');
    const file = path.join(directory, `${created.id}.sheet.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), sheet({}));

    assert.deepEqual(artefactsService.list(userId).map((item) => item.id), [created.id]);
    const opened = artefactsService.open(userId, created.id);
    assert.deepEqual(opened.content, sheet({}));
    assert.equal(opened.contentError, null);
    assert.match(opened.revision, /^\d+-\d+$/);
  });
});

test('only spreadsheets can be created, and only by their owner can they be read', async () => {
  await withArtefacts((userId) => {
    expectAppError(() => artefactsService.create(userId, { kind: 'doc' }), 'ARTEFACT_KIND_UNSUPPORTED');
    const created = artefactsService.create(userId, { kind: 'sheet' });
    const other = Number(userDb.createUser('someone-else', 'hash').id);
    expectAppError(() => artefactsService.open(other, created.id), 'ARTEFACT_NOT_FOUND');
    assert.deepEqual(artefactsService.list(other), []);
  });
});

test('saving needs the revision the editor loaded, so Claude\'s edits are never overwritten', async () => {
  await withArtefacts((userId) => {
    const created = artefactsService.create(userId, { kind: 'sheet' });
    const { revision } = artefactsService.open(userId, created.id);
    const saved = artefactsService.saveContent(userId, created.id, { content: sheet({ A1: 'Item', B1: 3 }), baseRevision: revision });
    assert.notEqual(saved.revision, revision);
    assert.deepEqual(artefactsService.open(userId, created.id).content, sheet({ A1: 'Item', B1: 3 }));

    // The editor still holds the first revision: the save is refused.
    expectAppError(
      () => artefactsService.saveContent(userId, created.id, { content: sheet({ A1: 'stale' }), baseRevision: revision }),
      'ARTEFACT_CHANGED',
    );
    expectAppError(
      () => artefactsService.saveContent(userId, created.id, { content: { format: 'csv' }, baseRevision: saved.revision }),
      'ARTEFACT_INVALID_CONTENT',
    );
  });
});

test('a file Claude broke opens with the reason instead of failing', async () => {
  await withArtefacts((userId, directory) => {
    const created = artefactsService.create(userId, { kind: 'sheet' });
    fs.writeFileSync(path.join(directory, `${created.id}.sheet.json`), '{ "format": "claudeweb-sheet@1", ');
    const opened = artefactsService.open(userId, created.id);
    assert.equal(opened.content, null);
    assert.equal(opened.contentError, 'The file is not valid JSON.');
  });
});

test('renaming, pinning and deleting, which removes the file too', async () => {
  await withArtefacts((userId, directory) => {
    const created = artefactsService.create(userId, { kind: 'sheet' });
    const updated = artefactsService.update(userId, created.id, { title: '  季度报表  ', pinned: true });
    assert.equal(updated.title, '季度报表');
    assert.equal(updated.pinned, true);
    expectAppError(() => artefactsService.update(userId, created.id, { title: ' ' }), 'INVALID_REQUEST_BODY');

    artefactsService.remove(userId, created.id);
    assert.equal(fs.existsSync(path.join(directory, `${created.id}.sheet.json`)), false);
    assert.deepEqual(artefactsService.list(userId), []);
  });
});

test('asking Claude creates the spreadsheet\'s conversation once and tells it which file to edit', async () => {
  await withArtefacts(async (userId, directory) => {
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);
    const created = artefactsService.create(userId, { kind: 'sheet', title: '预算' });

    const first = artefactsService.sendMessage(userId, created.id, { text: '做一个月度预算表', sessionTitle: '电子表格：预算' }, runtime);
    assert.equal(sessionsDb.getSessionById(first.sessionId)?.custom_name, '电子表格：预算');
    await waitForIdle(userId, created.id);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, '做一个月度预算表');
    assert.equal(runs[0].options.permissionMode, 'acceptEdits');
    assert.equal(runs[0].options.unattended, true);
    const instructions = String(runs[0].options.systemPromptAppend);
    assert.ok(instructions.includes(path.join(directory, `${created.id}.sheet.json`)));
    assert.ok(instructions.includes(SHEET_FORMAT));

    const second = artefactsService.sendMessage(userId, created.id, { text: '加一列备注' }, runtime);
    assert.equal(second.sessionId, first.sessionId, 'later requests continue the same conversation');
    await waitForIdle(userId, created.id);
    assert.equal(artefactsService.state(userId, created.id).sessionId, first.sessionId);
  });
});

test('the editor sees the spreadsheet as busy while Claude works on it, and cannot save over it', async () => {
  await withArtefacts(async (userId) => {
    let finish: (() => void) | null = null;
    const runtime = {
      hasRuntime: () => true,
      hasBackgroundWork: () => false,
      run: () => new Promise<void>((resolve) => { finish = resolve; }),
      abort: async () => true,
    } as never;
    const created = artefactsService.create(userId, { kind: 'sheet' });
    const { revision } = artefactsService.open(userId, created.id);

    artefactsService.sendMessage(userId, created.id, { text: 'Fill in the totals' }, runtime);
    assert.equal(artefactsService.state(userId, created.id).running, true);
    expectAppError(() => artefactsService.sendMessage(userId, created.id, { text: 'again' }, runtime), 'ARTEFACT_BUSY');
    expectAppError(
      () => artefactsService.saveContent(userId, created.id, { content: sheet({ A1: 1 }), baseRevision: revision }),
      'ARTEFACT_BUSY',
    );

    for (let attempt = 0; attempt < 200 && !finish; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(finish, 'the run reached the provider');
    (finish as () => void)();
    await waitForIdle(userId, created.id);
    assert.equal(artefactsService.state(userId, created.id).running, false);
  });
});

test('the format check names what is wrong', () => {
  assert.equal(validateSheetDocument(sheet({ A1: 'x', B2: 2, C3: true, D4: null })), null);
  assert.match(String(validateSheetDocument({ format: 'other', sheets: [] })), /format/);
  assert.match(String(validateSheetDocument({ format: SHEET_FORMAT, sheets: [] })), /non-empty/);
  assert.match(String(validateSheetDocument(sheet({ a1: 'x' }))), /A1 address/);
  assert.match(String(validateSheetDocument(sheet({ A1: { v: 1 } as never }))), /string, number, boolean or null/);
  assert.match(
    String(validateSheetDocument({ format: SHEET_FORMAT, sheets: [{ name: 'S', cells: {} }, { name: 'S', cells: {} }] })),
    /Two sheets/,
  );
});
