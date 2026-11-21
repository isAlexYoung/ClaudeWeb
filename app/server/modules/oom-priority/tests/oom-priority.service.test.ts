import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { descendants, raiseChildren } from '../oom-priority.service.js';

/** A fake /proc: pid -> [parent, command name, oom_score_adj]. */
function fakeProc(processes: Record<number, [number, string, number]>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-proc-'));
  for (const [pid, [parent, name, score]] of Object.entries(processes)) {
    fs.mkdirSync(path.join(root, pid));
    fs.writeFileSync(path.join(root, pid, 'stat'), `${pid} (${name}) S ${parent} ${pid} ${pid} 0 -1 4194304`);
    fs.writeFileSync(path.join(root, pid, 'oom_score_adj'), `${score}\n`);
  }
  fs.mkdirSync(path.join(root, 'self'));
  return root;
}
const score = (root: string, pid: number) => Number(fs.readFileSync(path.join(root, String(pid), 'oom_score_adj'), 'utf8'));

test('everything ClaudeWeb started is raised above ClaudeWeb, and nothing else is touched', () => {
  const root = fakeProc({
    1: [0, 'systemd', 0],
    80: [1, 'sshd', -1000],
    100: [1, 'node', -100],             // ClaudeWeb
    110: [100, 'claude', -100],         // the Claude CLI
    111: [110, 'bash', -100],           // a command Claude runs
    120: [100, 'Xtigervnc', -100],      // the browser's display
    121: [120, 'chrome (renderer)', 700], // already higher: left as it is
    200: [1, 'cron', 0],
  });
  try {
    assert.deepEqual(descendants({ procRoot: root, rootPid: 100 }).sort((a, b) => a - b), [110, 111, 120, 121]);
    assert.equal(raiseChildren({ procRoot: root, rootPid: 100 }), 3);
    assert.deepEqual([110, 111, 120].map((pid) => score(root, pid)), [500, 500, 500]);
    assert.equal(score(root, 121), 700);
    assert.equal(score(root, 100), -100, 'ClaudeWeb itself keeps its score');
    assert.equal(score(root, 80), -1000);
    assert.equal(score(root, 200), 0);
    assert.equal(raiseChildren({ procRoot: root, rootPid: 100 }), 0, 'a second pass changes nothing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing /proc or an unreadable process is skipped', () => {
  assert.deepEqual(descendants({ procRoot: path.join(os.tmpdir(), 'no-such-proc'), rootPid: 1 }), []);
  const root = fakeProc({ 10: [1, 'node', 0], 11: [10, 'gone', 0] });
  try {
    fs.rmSync(path.join(root, '11', 'oom_score_adj'));
    assert.equal(raiseChildren({ procRoot: root, rootPid: 10 }), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
