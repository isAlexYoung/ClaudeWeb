/**
 * Turns a loaded transcript into a downloadable file.
 *
 * The HTML path renders the app's real transcript components, so an exported
 * conversation looks like the one on screen — tool cards, diffs, highlighted
 * code, subagent timelines and all. Markdown and JSON are the plain-text and
 * machine-readable views of the same messages.
 */

import type { ChatMessage, DiffLine, LLMProvider, Project, TranscriptExportFormat } from '@/shared/types';
import { buildTranscriptHtml } from '@/modules/chat/export/buildTranscriptHtml';
import { buildTranscriptMarkdown } from '@/modules/chat/export/buildTranscriptMarkdown';
import { pickFileDownload } from '@/shared/utils';

export type TranscriptExportInput = {
  messages: ChatMessage[];
  sessionTitle: string;
  provider: LLMProvider | string;
  selectedProject?: Project | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
};

const EXTENSIONS: Record<TranscriptExportFormat, string> = {
  html: 'html',
  markdown: 'md',
  json: 'json',
};

const MIME_TYPES: Record<TranscriptExportFormat, string> = {
  html: 'text/html;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

/**
 * Makes a session title safe to use as a filename.
 *
 * Session titles are the user's first message, so they routinely contain
 * slashes and quotes; unsanitized they produced downloads named after only the
 * last path segment, or nothing at all.
 */
export function toExportFileStem(sessionTitle: string, exportedAt: Date): string {
  const date = exportedAt.toISOString().slice(0, 10);
  const slug = sessionTitle
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();

  return slug ? `${slug}-${date}` : `conversation-${date}`;
}

/** Builds the file's text without downloading it, so it can be asserted on. */
export async function buildTranscriptExport(
  format: TranscriptExportFormat,
  input: TranscriptExportInput,
  exportedAt: Date,
): Promise<string> {
  if (format === 'json') {
    return `${JSON.stringify(
      {
        title: input.sessionTitle,
        provider: input.provider,
        exportedAt: exportedAt.toISOString(),
        messageCount: input.messages.length,
        messages: input.messages,
      },
      null,
      2,
    )}\n`;
  }

  if (format === 'markdown') {
    return buildTranscriptMarkdown({
      messages: input.messages,
      sessionTitle: input.sessionTitle,
      provider: input.provider,
      exportedAt,
      createDiff: input.createDiff,
    });
  }

  return buildTranscriptHtml({
    messages: input.messages,
    createDiff: input.createDiff,
    provider: input.provider,
    selectedProject: input.selectedProject,
    sessionTitle: input.sessionTitle,
    exportedAt,
  });
}

export async function downloadTranscriptExport(
  format: TranscriptExportFormat,
  input: TranscriptExportInput | (() => Promise<TranscriptExportInput>),
  sessionTitle?: string,
): Promise<void> {
  const exportedAt = new Date();
  const filename = `${toExportFileStem(typeof input === 'function' ? sessionTitle || '' : input.sessionTitle, exportedAt)}.${EXTENSIONS[format]}`;
  // Open the native save dialog while the export click still has user activation.
  const destination = await pickFileDownload(filename);
  if (!destination) return;
  const resolved = typeof input === 'function' ? await input() : input;
  const content = await buildTranscriptExport(format, resolved, exportedAt);
  await destination.save(new Blob([content], { type: MIME_TYPES[format] }));
}
