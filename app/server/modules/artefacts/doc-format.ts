/**
 * The document format: a plain Markdown file (GitHub-flavoured).
 *
 * The editor (Tiptap) loads and saves Markdown directly, so Claude edits the
 * same text the user sees, with ordinary Read and Edit calls.
 */

/** Largest document the API reads or writes. */
export const MAX_DOC_BYTES = 2 * 1024 * 1024;

/** A new document: empty. */
export function blankDocDocument(): string {
  return '';
}

export function validateDocDocument(value: unknown): string | null {
  if (typeof value !== 'string') return 'A document must be Markdown text.';
  if (value.includes('\u0000')) return 'The document contains a NUL character.';
  return null;
}

/** Appended to the system prompt of a turn that edits a document. */
export function docEditingInstructions(filePath: string, title: string): string {
  return `You are editing the ClaudeWeb document "${title}". It is stored as Markdown in the file ${filePath}.
The user sees this document in a rich-text editor next to the conversation; the editor reloads the file as soon as you change it.
Make the change the user asks for by editing that file (Read it first, then Edit or Write it). Do not create other files unless the user asks for them, and reply with a short summary of what you changed.
Write GitHub-flavoured Markdown that the editor can show:
- Headings with #, ## and ### (the title of the document is usually a single # heading at the top).
- Paragraphs, **bold**, *italic*, ~~strikethrough~~, \`inline code\` and [links](https://example.com).
- Bulleted lists (-), numbered lists (1.) and task lists (- [ ] / - [x]), nested by indenting two spaces.
- > Quotes, fenced code blocks with a language (\`\`\`ts), horizontal rules (---) and images by URL (![alt](https://...)).
- Tables in the pipe syntax, with a header row and a separator row (| --- | --- |).
Do not use raw HTML, footnotes or front matter: the editor does not show them. Keep the user's existing content unless they ask you to remove it.`;
}
