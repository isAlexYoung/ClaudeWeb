import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyClaudeCodeTaskmasterDefaults } from '../taskmaster-defaults.service.js';

type Runner = Parameters<typeof applyClaudeCodeTaskmasterDefaults>[1];

const withProject = async (runTest: (projectPath: string) => Promise<void>) => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), 'taskmaster-defaults-'));
  await mkdir(path.join(projectPath, '.taskmaster'), { recursive: true });
  await writeFile(path.join(projectPath, '.taskmaster', 'config.json'), JSON.stringify({ models: {}, global: { logLevel: 'info' } }));
  try {
    await runTest(projectPath);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
};

const recordingRunner = (calls: string[][], code = 0): Runner => ((command, args, _options, onComplete) => {
  calls.push([command, ...args]);
  onComplete({ code, error: null, stdout: '', stderr: code === 0 ? '' : 'models failed' });
  return undefined as never;
}) as Runner;

test('init defaults point every model role at Claude Code and the shared CLI', async () => {
  await withProject(async (projectPath) => {
    const calls: string[][] = [];
    await applyClaudeCodeTaskmasterDefaults(projectPath, recordingRunner(calls), '/opt/claude-cli/.local/bin/claude');

    assert.deepEqual(calls, [
      ['npx', 'task-master', 'models', '--set-main', 'sonnet', '--claude-code'],
      ['npx', 'task-master', 'models', '--set-research', 'sonnet', '--claude-code'],
      ['npx', 'task-master', 'models', '--set-fallback', 'sonnet', '--claude-code'],
    ]);
    const config = JSON.parse(await readFile(path.join(projectPath, '.taskmaster', 'config.json'), 'utf8'));
    assert.deepEqual(config.claudeCode, { pathToClaudeCodeExecutable: '/opt/claude-cli/.local/bin/claude' });
    assert.deepEqual(config.global, { logLevel: 'info' }, 'other settings are kept');

    const tasks = JSON.parse(await readFile(path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json'), 'utf8'));
    assert.deepEqual(tasks.master.tasks, []);
  });
});

test('init defaults keep an existing task list and skip the CLI path when none is configured', async () => {
  await withProject(async (projectPath) => {
    const tasksPath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
    await mkdir(path.dirname(tasksPath), { recursive: true });
    await writeFile(tasksPath, '{"master":{"tasks":[{"id":1}]}}');

    await applyClaudeCodeTaskmasterDefaults(projectPath, recordingRunner([]), undefined);

    assert.equal(await readFile(tasksPath, 'utf8'), '{"master":{"tasks":[{"id":1}]}}');
    const config = JSON.parse(await readFile(path.join(projectPath, '.taskmaster', 'config.json'), 'utf8'));
    assert.equal('claudeCode' in config, false);
  });
});

test('a failing models command is reported, not ignored', async () => {
  await withProject(async (projectPath) => {
    await assert.rejects(
      applyClaudeCodeTaskmasterDefaults(projectPath, recordingRunner([], 1), undefined),
      /models failed/,
    );
  });
});
