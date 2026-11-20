import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('dashboard RPC reads real transcript files without OAuth, validates filters and leaves live authentication separate', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-dashboard-rpc-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Deliberately expired test credentials: /live returns locally without an upstream request.
  fs.writeFileSync(path.join(directory, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'test-expired', expiresAt: 1 } }));
  const record = (id: string) => JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', message: {
    id, model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 },
  } });
  for (const [folder, id] of [['-home-wdguest', 'chat'], ['-home-wdguest-projects-api', 'code']]) {
    const project = path.join(directory, 'projects', folder);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'session.jsonl'), record(id));
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Plugin did not become ready')), 10_000);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += String(chunk);
      const line = output.split('\n').find((value) => value.includes('"ready":true'));
      if (line) { clearTimeout(timer); resolve((JSON.parse(line) as { port: number }).port); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Plugin exited early (${code})`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/live`)).status, 401);
  const response = await fetch(`${base}/dashboard?range=all&timeZone=Asia%2FKuala_Lumpur&excludeProject=%2Fhome%2Fwdguest`);
  assert.equal(response.status, 200);
  const data = await response.json() as { summary: { messages: number; total: number }; start: string };
  assert.equal(data.summary.messages, 1);
  assert.equal(data.summary.total, 15);
  assert.equal(data.start, '2024-01-01');
  assert.equal((await fetch(`${base}/dashboard?range=invalid`)).status, 400);
  assert.equal((await fetch(`${base}/dashboard?timeZone=Invalid%2FZone`)).status, 400);
  // The original history endpoint keeps its previous shape and 30-day behavior.
  assert.equal((await fetch(`${base}/history?days=30`)).status, 200);
});
