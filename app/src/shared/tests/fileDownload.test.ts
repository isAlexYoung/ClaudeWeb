import assert from 'node:assert/strict';

import { afterEach, test, vi } from 'vitest';

import { pickFileDownload } from '@/shared/utils';

afterEach(() => { Reflect.deleteProperty(window, 'showSaveFilePicker'); vi.restoreAllMocks(); });

test('opens the native picker immediately and reuses its directory ID for the next download', async () => {
  const stream = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
  const picker = vi.fn(async () => ({ createWritable: async () => stream }));
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });
  const first = pickFileDownload('one.txt');
  assert.equal(picker.mock.calls.length, 1, 'picker is called before yielding user activation');
  const destination = await first;
  const content = new Blob(['original binary content']);
  await destination!.save(content);
  await pickFileDownload('two.zip');
  assert.deepEqual(picker.mock.calls.map((args: unknown[]) => args[0]), [
    { id: 'claudeweb-file-downloads', suggestedName: 'one.txt' },
    { id: 'claudeweb-file-downloads', suggestedName: 'two.zip' },
  ]);
  assert.equal(stream.write.mock.calls[0][0], content);
  assert.equal(stream.close.mock.calls.length, 1);
});

test('cancelling the picker does not create a writable file or start a fallback download', async () => {
  const picker = vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); });
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });
  assert.equal(await pickFileDownload('cancel.txt'), null);
});

test('aborts a failed save instead of closing a partially written file', async () => {
  const stream = { write: vi.fn(async () => { throw new Error('Disk full'); }), close: vi.fn(), abort: vi.fn(async () => {}) };
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({ createWritable: async () => stream }) });
  const destination = await pickFileDownload('large.bin');
  await assert.rejects(destination!.save(new Blob(['data'])), /Disk full/);
  assert.equal(stream.abort.mock.calls.length, 1);
  assert.equal(stream.close.mock.calls.length, 0);
});
