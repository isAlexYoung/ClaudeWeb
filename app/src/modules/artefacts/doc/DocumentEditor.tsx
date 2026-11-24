import { useCallback, useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { useTranslation } from 'react-i18next';
import { File } from 'lucide-react';

import { ScheduledTaskMenuItem } from '@/modules/scheduled-tasks';
import type { ArtefactDetail } from '@/shared/types';
import ArtefactEditorFrame from '@/modules/artefacts/editor/ArtefactEditorFrame';
import { downloadBlob, fileBaseName } from '@/modules/artefacts/editor/download';
import { useArtefactFileSync } from '@/modules/artefacts/editor/useArtefactFileSync';
import type { ArtefactEditorProps } from '@/modules/artefacts/editor/useArtefactFileSync';
import DocToolbar from '@/modules/artefacts/doc/DocToolbar';

/** Replaces what the editor shows without counting it as the user's change (nothing is saved). */
function showMarkdown(editor: Editor, markdown: string): void {
  editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
}

/**
 * Rendered by ArtefactEditor (lazily, with Tiptap) for a document. The file is
 * Markdown: the editor loads and saves it as Markdown, so Claude edits the same
 * text the user sees. Everything around the page — saving, Claude's runs, the
 * composer, the split view — is shared with the other artefact editors.
 */
export default function DocumentEditor({
  artefactId,
  menuButton,
  onClose,
  onMinimize,
  onOpenSession,
  embeddedSplit = false,
  chatOpen,
  onToggleChat,
  externalRunning = false,
  onSendChatMessage,
  registerFillComposer,
  onSessionResolved,
}: ArtefactEditorProps) {
  const { t } = useTranslation('sidebar');
  const editorRef = useRef<Editor | null>(null);
  // A file loaded before Tiptap was ready; shown as soon as it is.
  const waitingMarkdownRef = useRef<string | null>(null);

  const sync = useArtefactFileSync<string>({
    artefactId,
    kind: 'doc',
    onClose,
    onMinimize,
    embeddedSplit,
    chatOpen,
    onToggleChat,
    externalRunning,
    onSendChatMessage,
    registerFillComposer,
    onSessionResolved,
    toText: (markdown) => markdown,
    fromText: (text) => text,
    readContent: (detail: ArtefactDetail) => (typeof detail.content === 'string' ? detail.content : null),
    onLoaded: (markdown) => {
      const editor = editorRef.current;
      if (editor && !editor.isDestroyed) showMarkdown(editor, markdown);
      else waitingMarkdownRef.current = markdown;
    },
  });
  const { markChanged, running } = sync;
  // Tiptap keeps the onUpdate it was created with; it reaches the latest save through this.
  const markChangedRef = useRef(markChanged);
  useEffect(() => { markChangedRef.current = markChanged; }, [markChanged]);

  const editor = useEditor({
    extensions: [
      // Underline has no Markdown syntax, so it is left out rather than lost on save.
      StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Image,
      Placeholder.configure({ placeholder: t('artefacts.docEditor.placeholder') }),
      Markdown,
    ],
    content: '',
    editable: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'doc-editor-prose', 'aria-label': t('artefacts.kinds.doc') } },
    onUpdate: ({ editor: current }) => markChangedRef.current(current.getMarkdown()),
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor && waitingMarkdownRef.current !== null) {
      showMarkdown(editor, waitingMarkdownRef.current);
      waitingMarkdownRef.current = null;
    }
  }, [editor]);

  // Read-only until the file has loaded, and while Claude edits it. Switching
  // must not emit an update (Tiptap's default), or opening a document would save it.
  const loaded = sync.detail !== null;
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(loaded && !running, false);
  }, [editor, loaded, running]);

  const downloadMarkdown = useCallback(() => {
    const markdown = editorRef.current?.getMarkdown() ?? sync.currentText() ?? '';
    downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${fileBaseName(sync.detail?.title ?? '')}.md`);
  }, [sync]);

  return (
    <ArtefactEditorFrame
      sync={sync as never}
      icon={File}
      menuButton={menuButton}
      embeddedSplit={embeddedSplit}
      onOpenSession={onOpenSession}
      surfaceClassName="doc-editor-surface"
      titleMenuItems={(closeMenu) => (
        <ScheduledTaskMenuItem label={t('artefacts.docEditor.downloadMarkdown')} onSelect={() => { closeMenu(); downloadMarkdown(); }} />
      )}
      toolbar={(
        <DocToolbar
          editor={editor}
          disabled={running || !loaded}
          composerOpen={sync.composerOpen}
          onToggleComposer={() => sync.setComposerOpen((value) => !value)}
        />
      )}
    >
      <div className="doc-editor-page">
        {loaded ? null : <p role="status" className="artefacts-status">{t('artefacts.loading')}</p>}
        <EditorContent editor={editor} />
      </div>
    </ArtefactEditorFrame>
  );
}
