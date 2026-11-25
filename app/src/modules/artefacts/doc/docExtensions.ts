import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';

/**
 * What a document can hold, shared by DocumentEditor and the document
 * importers and exporters, so a file converted in or out reads exactly as the
 * editor shows it.
 */
export function docExtensions(): Extensions {
  return [
    // Underline has no Markdown syntax, so it is left out rather than lost on save.
    StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Image,
    Markdown,
  ];
}
