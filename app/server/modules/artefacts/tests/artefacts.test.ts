import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { artefactsService, resolveArtefactTurnContext } from '@/modules/artefacts/services/artefacts.service.js';
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

test('a new spreadsheet is an empty sheet on disk with its own conversation, listed and opened with its revision', async () => {
  await withArtefacts((userId, directory) => {
    const created = artefactsService.create(userId, { kind: 'sheet', title: '预算' });
    assert.equal(created.title, '预算');
    assert.equal(created.kind, 'sheet');
    assert.ok(created.sessionId, 'creating a spreadsheet immediately allocates its dedicated conversation');
    assert.equal(sessionsDb.getSessionById(created.sessionId)?.custom_name, '预算');
    const file = path.join(directory, `${created.id}.sheet.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), sheet({}));

    assert.deepEqual(artefactsService.list(userId).map((item) => item.id), [created.id]);
    const opened = artefactsService.open(userId, created.id);
    assert.equal(opened.sessionId, created.sessionId);
    assert.deepEqual(opened.content, sheet({}));
    assert.equal(opened.contentError, null);
    assert.match(opened.revision, /^\d+-\d+$/);

    const turnContext = resolveArtefactTurnContext(created.sessionId);
    assert.ok(turnContext?.systemPromptAppend?.includes(file));
    assert.ok(turnContext?.systemPromptAppend?.includes(SHEET_FORMAT));
  });
});

test('only the editable kinds can be created, and only by their owner can they be read', async () => {
  await withArtefacts((userId) => {
    expectAppError(() => artefactsService.create(userId, { kind: 'slides' }), 'ARTEFACT_KIND_UNSUPPORTED');
    expectAppError(() => artefactsService.create(userId, {}), 'ARTEFACT_KIND_UNSUPPORTED');
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

test('a new document is an empty Markdown file; it saves text and tells Claude to write Markdown', async () => {
  await withArtefacts((userId, directory) => {
    const created = artefactsService.create(userId, { kind: 'doc', title: '周报' });
    assert.equal(created.kind, 'doc');
    const file = path.join(directory, `${created.id}.md`);
    assert.equal(fs.readFileSync(file, 'utf8'), '');

    const opened = artefactsService.open(userId, created.id);
    assert.equal(opened.content, '');
    assert.equal(opened.contentError, null);
    const markdown = '# 周报\n\n- [x] 发布 2.3.4\n- [ ] 写测试\n';
    const saved = artefactsService.saveContent(userId, created.id, { content: markdown, baseRevision: opened.revision });
    assert.equal(fs.readFileSync(file, 'utf8'), markdown);
    assert.equal(artefactsService.open(userId, created.id).content, markdown);

    expectAppError(
      () => artefactsService.saveContent(userId, created.id, { content: { text: markdown }, baseRevision: saved.revision }),
      'ARTEFACT_INVALID_CONTENT',
    );
    expectAppError(
      () => artefactsService.saveContent(userId, created.id, { content: 'stale', baseRevision: opened.revision }),
      'ARTEFACT_CHANGED',
    );

    const instructions = resolveArtefactTurnContext(created.sessionId!)?.systemPromptAppend ?? '';
    assert.ok(instructions.includes(file));
    assert.match(instructions, /Markdown/);
  });
});

test('a new whiteboard is an empty Excalidraw scene; elements must at least name their type', async () => {
  await withArtefacts(async (userId, directory) => {
    const created = artefactsService.create(userId, { kind: 'whiteboard', title: '架构图' });
    assert.equal(created.kind, 'whiteboard');
    const file = path.join(directory, `${created.id}.excalidraw`);
    const blank = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(blank.type, 'excalidraw');
    assert.deepEqual(blank.elements, []);

    const opened = artefactsService.open(userId, created.id);
    assert.deepEqual(opened.content, blank);
    const scene = { ...blank, elements: [{ type: 'rectangle', id: 'box', x: 0, y: 0, width: 100, height: 60, label: { text: 'API' } }] };
    artefactsService.saveContent(userId, created.id, { content: scene, baseRevision: opened.revision });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), scene);

    const { revision } = artefactsService.open(userId, created.id);
    expectAppError(
      () => artefactsService.saveContent(userId, created.id, { content: { ...blank, elements: [{ x: 1 }] }, baseRevision: revision }),
      'ARTEFACT_INVALID_CONTENT',
    );
    fs.writeFileSync(file, JSON.stringify({ type: 'tldraw', elements: [] }));
    assert.equal(artefactsService.open(userId, created.id).contentError, '"type" must be "excalidraw".');

    const runs: RunCall[] = [];
    artefactsService.sendMessage(userId, created.id, { text: '画一张登录流程图' }, createRuntime(runs));
    await waitForIdle(userId, created.id);
    const instructions = String(runs[0].options.systemPromptAppend);
    assert.ok(instructions.includes(file));
    assert.match(instructions, /Excalidraw/);
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
    assert.equal(sessionsDb.getSessionById(created.sessionId!)?.custom_name, '季度报表');
    expectAppError(() => artefactsService.update(userId, created.id, { title: ' ' }), 'INVALID_REQUEST_BODY');

    artefactsService.remove(userId, created.id);
    assert.equal(fs.existsSync(path.join(directory, `${created.id}.sheet.json`)), false);
    assert.deepEqual(artefactsService.list(userId), []);
  });
});

test('asking Claude reuses the spreadsheet\'s conversation and tells it which file to edit', async () => {
  await withArtefacts(async (userId, directory) => {
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);
    const created = artefactsService.create(userId, { kind: 'sheet', title: '预算' });

    const first = artefactsService.sendMessage(userId, created.id, { text: '做一个月度预算表', sessionTitle: '电子表格：预算' }, runtime);
    assert.equal(first.sessionId, created.sessionId);
    assert.equal(sessionsDb.getSessionById(first.sessionId)?.custom_name, '预算');
    await waitForIdle(userId, created.id);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, '做一个月度预算表');
    assert.equal(runs[0].options.permissionMode, 'acceptEdits');
    assert.equal(runs[0].options.unattended, true);
    const instructions = String(runs[0].options.systemPromptAppend);
    assert.ok(instructions.includes(path.join(directory, `${created.id}.sheet.json`)));
    assert.ok(instructions.includes(SHEET_FORMAT));

    const second = artefactsService.sendMessage(userId, created.id, {
      text: '加一列备注',
      model: 'claude-haiku-5-5',
      effort: 'high',
      mcpEnabled: false,
    }, runtime);
    assert.equal(second.sessionId, first.sessionId, 'later requests continue the same conversation');
    await waitForIdle(userId, created.id);
    assert.equal(artefactsService.state(userId, created.id).sessionId, first.sessionId);
    assert.equal(runs[1].options.model, 'claude-haiku-5-5');
    assert.equal(runs[1].options.effort, 'high');
    assert.equal(runs[1].options.mcpEnabled, false);
    assert.equal(sessionsDb.getSessionById(first.sessionId)?.model, 'claude-haiku-5-5');
    assert.equal(sessionsDb.getSessionById(first.sessionId)?.effort, 'high');
  });
});

test('a provider error emitted on the writer without throwing is recorded in state.lastError', async () => {
  await withArtefacts(async (userId) => {
    const runtime = {
      hasRuntime: () => true,
      hasBackgroundWork: () => false,
      run: async (_provider: string, _command: string, _options: Record<string, unknown>, writer: { send: (data: unknown) => void }) => {
        writer.send({ kind: 'error', content: 'No conversation found with session ID: fake', provider: 'claude' });
        writer.send({ kind: 'complete', exitCode: 1, provider: 'claude' });
      },
      abort: async () => true,
    } as never;
    const created = artefactsService.create(userId, { kind: 'sheet', title: '失败测试' });
    artefactsService.sendMessage(userId, created.id, { text: '做一个预算表' }, runtime);
    await waitForIdle(userId, created.id);

    assert.equal(artefactsService.state(userId, created.id).lastError, 'No conversation found with session ID: fake');
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

test('an imported file is created with its content, checked like a save, and nothing is left behind when it is refused', async () => {
  await withArtefacts((userId, directory) => {
    const imported = sheet({ A1: '名称', B1: 42 });
    const created = artefactsService.create(userId, { kind: 'sheet', title: '导入', content: imported });
    assert.deepEqual(artefactsService.open(userId, created.id).content, imported);

    const doc = artefactsService.create(userId, { kind: 'doc', title: 'README', content: '# Hello\n' });
    assert.equal(fs.readFileSync(path.join(directory, `${doc.id}.md`), 'utf8'), '# Hello\n');

    const before = artefactsService.list(userId).length;
    expectAppError(() => artefactsService.create(userId, { kind: 'sheet', content: { format: 'nope' } }), 'ARTEFACT_INVALID_CONTENT');
    expectAppError(() => artefactsService.create(userId, { kind: 'whiteboard', content: { type: 'excalidraw', elements: [{ x: 1 }] } }), 'ARTEFACT_INVALID_CONTENT');
    expectAppError(() => artefactsService.create(userId, { kind: 'doc', content: 'x'.repeat(2 * 1024 * 1024 + 1) }), 'ARTEFACT_TOO_LARGE');
    assert.equal(artefactsService.list(userId).length, before);
    assert.equal(fs.readdirSync(directory).length, 2);
  });
});
