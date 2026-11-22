import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cleanDesktopCaches } from '@/modules/graphical-session/desktop-profile.service.js';

test('closing reclaims cache files while retaining login databases, settings and keyring material', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-cleanup-'));
  const profile = path.join(home, '.config/claudeweb-desktop');
  const keep = ['Claude/Local Storage/login', 'Claude/Cookies', 'Claude/Preferences', 'data/keyrings/login.keyring', '.keyring-secret'];
  try {
    for (const file of [...keep, 'Claude/Cache/Cache_Data/a', 'Claude/Code Cache/js/a', 'Claude/GPUCache/a']) {
      const target = path.join(profile, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file);
    }
    const cache = path.join(home, '.cache/claudeweb-desktop-cache/tmp');
    fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, 'cache');
    cleanDesktopCaches(home);
    for (const file of keep) assert.equal(fs.readFileSync(path.join(profile, file), 'utf8'), file);
    for (const file of ['Claude/Cache', 'Claude/Code Cache', 'Claude/GPUCache']) assert.equal(fs.existsSync(path.join(profile, file)), false);
    assert.equal(fs.existsSync(cache), false);
    cleanDesktopCaches(home);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('cleanup does not follow a profile symlink into another directory', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-links-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-outside-'));
  try {
    fs.mkdirSync(path.join(outside, 'Claude/Cache'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'Claude/Cache/keep'), 'safe');
    fs.mkdirSync(path.join(home, '.config'));
    fs.symlinkSync(outside, path.join(home, '.config/claudeweb-desktop'), 'dir');
    cleanDesktopCaches(home);
    assert.equal(fs.readFileSync(path.join(outside, 'Claude/Cache/keep'), 'utf8'), 'safe');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
