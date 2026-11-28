import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

import catalog from '@/modules/clawd/data/clawd-catalog.json';
import { clawdAnimation } from '@/modules/clawd/catalog';
import { festivalsOn } from '@/modules/clawd/festivals';
import { ALL_GREETING_ANIMATIONS, ALL_GREETING_IDS, pickGreeting } from '@/modules/clawd/greetings';
import { CLAWD_STATE_ANIMATIONS, nextAnimation, randomAnimation, stateForTool } from '@/modules/clawd/states';
import en from '@/modules/i18n/locales/en/common.json';
import zh from '@/modules/i18n/locales/zh-CN/common.json';

const local = (text: string) => { const [y, m, d] = text.split('-').map(Number); return new Date(y, m - 1, d, 12); };

test('the catalog lists all 400 animations, each with a frame strip of the right width', () => {
  assert.equal(catalog.length, 400);
  assert.deepEqual(catalog.map((item) => item.n), Array.from({ length: 400 }, (_, index) => index + 1));
  const sheets = path.resolve(__dirname, '../../../../public/clawd');
  for (const item of catalog) {
    assert.ok(item.d.length >= 1 && item.d.every((ms) => Number.isInteger(ms) && ms > 0), `${item.n} durations`);
    const png = fs.readFileSync(path.join(sheets, `${String(item.n).padStart(3, '0')}.png`));
    // A PNG's IHDR holds the width and height big-endian at bytes 16 and 20.
    assert.equal(png.readUInt32BE(16), 40 * item.d.length, `${item.n} width`);
    assert.equal(png.readUInt32BE(20), 40, `${item.n} height`);
  }
});

test('every state and greeting uses animations that exist', () => {
  for (const [state, pool] of Object.entries(CLAWD_STATE_ANIMATIONS)) {
    assert.ok(pool.length >= 2, `${state} has a choice for double click`);
    for (const n of pool) assert.ok(clawdAnimation(n), `${state}: ${n}`);
  }
  for (const n of ALL_GREETING_ANIMATIONS) assert.ok(clawdAnimation(n), `greeting: ${n}`);
});

test('every greeting has its bubble and prompt in English and Chinese', () => {
  const read = (bundle: unknown, id: string, field: string) => (bundle as { clawd: { greetings: Record<string, Record<string, string>> } }).clawd.greetings[id]?.[field];
  for (const id of ALL_GREETING_IDS) {
    for (const bundle of [en, zh]) {
      assert.ok(read(bundle, id, 'text'), `${id} text`);
      assert.ok(read(bundle, id, 'prompt'), `${id} prompt`);
    }
  }
});

test('Chinese lunar festivals fall on their lunar dates, leap months excepted', () => {
  assert.deepEqual(festivalsOn(local('2026-02-16')), ['chuxi']);
  assert.deepEqual(festivalsOn(local('2026-02-17')), ['springFestival']);
  assert.deepEqual(festivalsOn(local('2026-02-23')), ['springFestival']);
  assert.deepEqual(festivalsOn(local('2026-02-24')), []);
  assert.deepEqual(festivalsOn(local('2026-03-03')), ['lantern']);
  assert.deepEqual(festivalsOn(local('2026-06-19')), ['dragonBoat']);
  assert.deepEqual(festivalsOn(local('2026-08-19')), ['qixi']);
  assert.deepEqual(festivalsOn(local('2026-09-25')), ['midAutumn']);
  assert.deepEqual(festivalsOn(local('2026-10-18')), ['chongyang']);
  assert.deepEqual(festivalsOn(local('2027-01-15')), ['laba']);
  // The first day of the leap sixth month of 2025 is not the sixth month's first day.
  assert.deepEqual(festivalsOn(local('2025-07-25')), []);
});

test('Western and Chinese solar holidays, including the moving ones', () => {
  assert.deepEqual(festivalsOn(local('2026-01-01')), ['newYear']);
  assert.deepEqual(festivalsOn(local('2026-02-14')), ['valentine']);
  assert.deepEqual(festivalsOn(local('2026-04-05')), ['easter']);
  assert.deepEqual(festivalsOn(local('2026-05-10')), ['mothersDay']);
  assert.deepEqual(festivalsOn(local('2026-06-21')), ['fathersDay']);
  assert.deepEqual(festivalsOn(local('2026-10-24')), ['programmersDay']);
  assert.deepEqual(festivalsOn(local('2026-10-31')), ['halloween']);
  assert.deepEqual(festivalsOn(local('2026-11-26')), ['thanksgiving']);
  assert.deepEqual(festivalsOn(local('2026-12-24')), ['christmasEve']);
  assert.deepEqual(festivalsOn(local('2026-12-25')), ['christmas']);
  assert.deepEqual(festivalsOn(local('2026-12-31')), ['newYearsEve']);
  assert.deepEqual(festivalsOn(local('2026-03-10')), []);
});

test('a holiday greeting replaces the daily one unless holiday greetings are off', () => {
  const christmas = new Date(2026, 11, 25, 9);
  assert.equal(pickGreeting('chat', christmas, { festivals: true, roll: 0.9 }).id, 'christmas');
  assert.equal(pickGreeting('chat', christmas, { festivals: false, roll: 0.1 }).id, 'chatMorning');
  assert.equal(pickGreeting('code', new Date(2026, 2, 10, 23), { festivals: true, roll: 0.1 }).id, 'codeNight');
  assert.match(pickGreeting('code', new Date(2026, 2, 10, 15), { festivals: true, roll: 0.99 }).id, /^code/);
});

test('tools map to what Clawd acts out, and switching stays within a state', () => {
  assert.equal(stateForTool('Edit'), 'editing');
  assert.equal(stateForTool('Bash'), 'command');
  assert.equal(stateForTool('Grep'), 'searching');
  assert.equal(stateForTool('Task'), 'agent');
  assert.equal(stateForTool('TodoWrite'), 'planning');
  assert.equal(stateForTool('mcp__github__create_issue'), 'tool');
  const pool = CLAWD_STATE_ANIMATIONS.done;
  assert.equal(nextAnimation(pool, pool[pool.length - 1]), pool[0]);
  assert.notEqual(randomAnimation(pool, pool[0], 0), pool[0]);
});
