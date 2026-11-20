import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runBuildIfNeeded } from '../plugin-build.service.js';

function build(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    runBuildIfNeeded(dir, path.join(dir, 'package.json'), resolve, reject);
  });
}

function fixture(scripts: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin build '));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'build-fixture', scripts }));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a tsc build reads the compiler JS even when it has no executable permission', async (t) => {
  const { dir, cleanup } = fixture({ build: 'tsc' });
  t.after(cleanup);
  const compiler = path.join(dir, 'node_modules/typescript/bin/tsc');
  fs.mkdirSync(path.dirname(compiler), { recursive: true });
  fs.writeFileSync(compiler,
    "require('fs').writeFileSync('compiled.txt', 'ok'); process.stdout.write('x'.repeat(1024 * 1024));",
    { mode: 0o600 });
  // No .bin/tsc exists: an npm/shell invocation would fail even on Windows.
  await build(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'compiled.txt'), 'utf8'), 'ok');
});

test('a compiler failure reaches the caller with its diagnostic', async (t) => {
  const { dir, cleanup } = fixture({ build: 'tsc' });
  t.after(cleanup);
  const compiler = path.join(dir, 'node_modules/typescript/bin/tsc');
  fs.mkdirSync(path.dirname(compiler), { recursive: true });
  fs.writeFileSync(compiler, "process.stderr.write('fixture type error'); process.exit(2);");
  await assert.rejects(build(dir), /fixture type error/);
});

test('other build scripts continue to run through npm', async (t) => {
  const { dir, cleanup } = fixture({ build: 'node -e "require(\'fs\').writeFileSync(\'custom.txt\', \'ok\')"' });
  t.after(cleanup);
  await build(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'custom.txt'), 'utf8'), 'ok');
});

test('a tsc build with npm lifecycle hooks does not bypass those hooks', async (t) => {
  const { dir, cleanup } = fixture({ build: 'tsc', prebuild: 'node -e "process.stderr.write(\'prebuild was run\'); process.exit(7)"' });
  t.after(cleanup);
  await assert.rejects(build(dir), /prebuild was run/);
});

test('a package without a build script is left alone', async (t) => {
  const { dir, cleanup } = fixture({});
  t.after(cleanup);
  await build(dir);
  assert.deepEqual(fs.readdirSync(dir), ['package.json']);
});
