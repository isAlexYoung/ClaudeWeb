import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDesktopService } from '@/modules/claude-desktop/claude-desktop.service.js';

test('Desktop status and close are idempotent without starting any application', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-test-'));
  try {
    const service = createDesktopService(home);
    const sid = 'b'.repeat(24);
    assert.deepEqual(JSON.parse((await service.status(sid)).body.toString()), { state: 'none' });
    assert.deepEqual(JSON.parse((await service.end(sid)).body.toString()), { ok: true });
    await service.shutdown();
    await assert.rejects(service.end('../other-session'));
    await assert.rejects(service.text({ sid, op: 'read' }));
    assert.equal(fs.readdirSync(home).length, 0);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
