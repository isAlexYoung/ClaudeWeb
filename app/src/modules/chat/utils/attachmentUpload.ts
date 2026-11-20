import { api, ApiRequestError, readApiJson } from '@/shared/api';
import type { AttachmentUploadProgress } from '@/shared/types';

/**
 * Chat attachments go up in pieces (8 MB, the size the server asks for), so
 * a file of up to 256 MB never makes a request larger than the 100 MB that
 * the Cloudflare Tunnel in front of ClaudeWeb accepts. A piece that fails on
 * the network or with a server error is sent again a few times before the
 * upload gives up.
 */

export const MAX_ATTACHMENT_SIZE = 256 * 1024 * 1024;
const PIECE_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 2000];

type UploadOptions = {
  projectPath?: string | null;
  sessionId?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: AttachmentUploadProgress) => void;
};

export class AttachmentUploadCancelled extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'AttachmentUploadCancelled';
  }
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(new AttachmentUploadCancelled());
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(new AttachmentUploadCancelled());
  };
  signal?.addEventListener('abort', onAbort, { once: true });
});

const isRetryable = (error: unknown) => (
  error instanceof ApiRequestError ? error.status >= 500 || error.status === 429 : !(error instanceof AttachmentUploadCancelled)
);

async function sendPiece(uploadId: string, index: number, piece: Blob, signal?: AbortSignal): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await api.assets.uploadChunk(uploadId, index, piece, signal);
      await readApiJson(response);
      return;
    } catch (error) {
      if (signal?.aborted) throw new AttachmentUploadCancelled();
      if (attempt >= PIECE_ATTEMPTS || !isRetryable(error)) throw error;
      await wait(RETRY_DELAYS_MS[attempt - 1] ?? 2000, signal);
    }
  }
}

async function uploadOne(
  file: File,
  options: UploadOptions,
  reportLoaded: (bytes: number) => void,
): Promise<unknown> {
  const { uploadId, chunkSize } = await readApiJson<{ uploadId: string; chunkSize: number }>(
    await api.assets.createUpload({
      name: file.name || 'file',
      size: file.size,
      mimeType: file.type || undefined,
      projectPath: options.projectPath || undefined,
      sessionId: options.sessionId || undefined,
    }),
  );
  try {
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || typeof uploadId !== 'string' || !uploadId) {
      throw new Error('The server returned an invalid upload configuration.');
    }
    for (let index = 0, offset = 0; offset < file.size; index += 1, offset += chunkSize) {
      if (options.signal?.aborted) throw new AttachmentUploadCancelled();
      const piece = file.slice(offset, Math.min(offset + chunkSize, file.size));
      await sendPiece(uploadId, index, piece, options.signal);
      reportLoaded(piece.size);
    }
    if (options.signal?.aborted) throw new AttachmentUploadCancelled();
    const { attachment } = await readApiJson<{ attachment: unknown }>(await api.assets.completeUpload(uploadId, options.signal));
    // Cancellation during finalization must not submit the message either.
    if (options.signal?.aborted) throw new AttachmentUploadCancelled();
    return attachment;
  } catch (error) {
    // Frees the server's temporary file; it would otherwise be dropped after two hours.
    void api.assets.cancelUpload(uploadId).catch(() => undefined);
    if (options.signal?.aborted) throw new AttachmentUploadCancelled();
    throw error;
  }
}

/** Uploads the files one after another and returns their attachment records, in order. */
export async function uploadAttachmentFiles(files: File[], options: UploadOptions = {}): Promise<unknown[]> {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let loaded = 0;
  options.onProgress?.({ loaded, total, fileIndex: 0, fileLoaded: 0, fileTotal: files[0]?.size ?? 0 });
  const attachments: unknown[] = [];
  for (const [fileIndex, file] of files.entries()) {
    if (options.signal?.aborted) throw new AttachmentUploadCancelled();
    let fileLoaded = 0;
    attachments.push(await uploadOne(file, options, (bytes) => {
      loaded += bytes;
      fileLoaded += bytes;
      options.onProgress?.({ loaded, total, fileIndex, fileLoaded, fileTotal: file.size });
    }));
  }
  return attachments;
}
