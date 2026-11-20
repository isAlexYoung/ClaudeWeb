import { afterEach, expect, test, vi } from 'vitest';

import { downloadTranscriptExport } from '@/modules/chat/utils/chatExport';
import type { TranscriptExportFormat } from '@/shared/types';

vi.mock('@/modules/chat/export/buildTranscriptHtml', () => ({ buildTranscriptHtml: async () => '<html>export</html>' }));
vi.mock('@/modules/chat/export/buildTranscriptMarkdown', () => ({ buildTranscriptMarkdown: () => '# Export' }));
afterEach(() => { Reflect.deleteProperty(window, 'showSaveFilePicker'); });

test.each(['html', 'markdown', 'json'] as TranscriptExportFormat[])('%s export picks a destination before loading history', async format => {
  const write = vi.fn(), close = vi.fn();
  const picker = vi.fn(async () => ({ createWritable: async () => ({ write, close, abort: vi.fn() }) }));
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });
  const load = vi.fn(async () => {
    expect(picker).toHaveBeenCalledTimes(1);
    return { sessionTitle: 'My title', messages: [], provider: 'claude', createDiff: () => [] };
  });
  await downloadTranscriptExport(format, load, 'My title');
  expect(load).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  expect(picker.mock.calls[0]).toBeDefined();
});

test('canceling the save dialog cancels export before fetching history', async () => {
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => { throw new DOMException('Canceled', 'AbortError'); } });
  const load = vi.fn(); await downloadTranscriptExport('json', load, 'My title');
  expect(load).not.toHaveBeenCalled();
});
