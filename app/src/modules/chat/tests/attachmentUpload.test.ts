import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

import { AttachmentUploadCancelled, uploadAttachmentFiles } from '@/modules/chat/utils/attachmentUpload';

const assets = vi.hoisted(() => ({
  createUpload: vi.fn(),
  uploadChunk: vi.fn(),
  completeUpload: vi.fn(),
  cancelUpload: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { assets },
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.useRealTimers();
  for (const mock of Object.values(assets)) mock.mockReset();
  assets.createUpload.mockImplementation(async (upload: { name: string }) => json({ uploadId: `id-${upload.name}`, chunkSize: 4 }));
  assets.uploadChunk.mockImplementation(async () => json({ received: 0 }));
  assets.completeUpload.mockImplementation(async (id: string) => json({ attachment: { path: `/assets/${id}` } }));
  assets.cancelUpload.mockImplementation(async () => json({ cancelled: true }));
});

test('files go up in pieces of the size the server asks for, with progress', async () => {
  const progress: number[] = [];
  const result = await uploadAttachmentFiles(
    [new File(['abcdefghij'], 'a.txt', { type: 'text/plain' }), new File([''], 'empty.txt')],
    { projectPath: '/srv/site', sessionId: 's1', onProgress: ({ loaded }) => progress.push(loaded) },
  );

  assert.deepEqual(result, [{ path: '/assets/id-a.txt' }, { path: '/assets/id-empty.txt' }]);
  assert.deepEqual(assets.createUpload.mock.calls[0][0], {
    name: 'a.txt', size: 10, mimeType: 'text/plain', projectPath: '/srv/site', sessionId: 's1',
  });
  assert.deepEqual(assets.uploadChunk.mock.calls.map(([id, index, piece]) => [id, index, (piece as Blob).size]), [
    ['id-a.txt', 0, 4], ['id-a.txt', 1, 4], ['id-a.txt', 2, 2],
  ]);
  assert.deepEqual(progress, [0, 4, 8, 10]);
});

test('a piece that fails with a server error is sent again', async () => {
  assets.uploadChunk
    .mockImplementationOnce(async () => json({ error: { code: 'X', message: 'busy' } }, 503))
    .mockImplementation(async () => json({ received: 4 }));
  vi.useFakeTimers();
  const upload = uploadAttachmentFiles([new File(['abcd'], 'a.txt')]);
  await vi.runAllTimersAsync();
  assert.deepEqual(await upload, [{ path: '/assets/id-a.txt' }]);
  assert.equal(assets.uploadChunk.mock.calls.length, 2);
});

test('a refused piece stops the upload and frees the server copy', async () => {
  assets.uploadChunk.mockImplementation(async () => json({ error: { code: 'UPLOAD_CHUNK_INVALID', message: 'bad piece' } }, 400));
  await assert.rejects(uploadAttachmentFiles([new File(['abcd'], 'a.txt')]), /bad piece/);
  assert.equal(assets.uploadChunk.mock.calls.length, 1);
  assert.deepEqual(assets.cancelUpload.mock.calls, [['id-a.txt']]);
});

test('cancelling stops between pieces', async () => {
  const controller = new AbortController();
  assets.uploadChunk.mockImplementation(async () => {
    controller.abort();
    return json({ received: 4 });
  });
  await assert.rejects(
    uploadAttachmentFiles([new File(['abcdefgh'], 'a.txt')], { signal: controller.signal }),
    (error: unknown) => error instanceof AttachmentUploadCancelled,
  );
  assert.equal(assets.completeUpload.mock.calls.length, 0);
  assert.deepEqual(assets.cancelUpload.mock.calls, [['id-a.txt']]);
});

test('cancelling after the last piece does not finalize or send an attachment', async () => {
  const controller = new AbortController();
  assets.uploadChunk.mockImplementation(async () => {
    controller.abort();
    return json({ received: 4 });
  });
  await assert.rejects(
    uploadAttachmentFiles([new File(['abcd'], 'a.txt')], { signal: controller.signal }),
    (error: unknown) => error instanceof AttachmentUploadCancelled,
  );
  assert.equal(assets.completeUpload.mock.calls.length, 0);
  assert.equal(assets.cancelUpload.mock.calls.length, 1);
});

test('cancelling during finalization does not return an attachment for sending', async () => {
  const controller = new AbortController();
  assets.completeUpload.mockImplementation(async () => {
    controller.abort();
    return json({ attachment: { path: '/assets/a.txt' } });
  });
  await assert.rejects(
    uploadAttachmentFiles([new File(['abcd'], 'a.txt')], { signal: controller.signal }),
    (error: unknown) => error instanceof AttachmentUploadCancelled,
  );
});

test('an invalid chunk size fails instead of starting an endless upload', async () => {
  assets.createUpload.mockImplementation(async () => json({ uploadId: 'bad', chunkSize: 0 }));
  await assert.rejects(uploadAttachmentFiles([new File(['abcd'], 'a.txt')]), /invalid upload configuration/);
  assert.equal(assets.uploadChunk.mock.calls.length, 0);
  assert.deepEqual(assets.cancelUpload.mock.calls, [['bad']]);
});
