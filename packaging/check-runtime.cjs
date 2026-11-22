// Load the shipped native modules before an install/update replaces the service.
// Uses only an in-memory database and a private PTY, never application data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const appRequire = createRequire(path.resolve(process.argv[2], 'package.json'));

async function main() {
  const Database = appRequire('better-sqlite3');
  const db = new Database(':memory:');
  try {
    assert.equal(db.prepare('SELECT 42 AS value').get().value, 42);
  } finally {
    db.close();
  }
  const bcrypt = appRequire('bcrypt');
  assert.ok(await bcrypt.compare('runtime-check', await bcrypt.hash('runtime-check', 4)));
  const pty = appRequire('node-pty');
  await new Promise((resolve, reject) => {
    const child = pty.spawn('/bin/sh', ['-c', 'printf claudeweb-pty-ok'], {
      name: 'xterm', cols: 80, rows: 24, cwd: '/tmp', env: { PATH: '/usr/bin:/bin' },
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('PTY probe timed out')); }, 5000);
    child.onData((data) => { output += data; });
    child.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode === 0 && output.includes('claudeweb-pty-ok')) resolve();
      else reject(new Error(`PTY probe failed (exit ${exitCode})`));
    });
  });
  console.log('Native runtime check passed (SQLite, bcrypt, PTY)');
}

main().catch((error) => { console.error(`Incompatible ClaudeWeb runtime: ${error.message}`); process.exitCode = 1; });
