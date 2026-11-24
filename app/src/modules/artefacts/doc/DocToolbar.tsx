import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import {
  Bold,
  ChevronDown,
  Code,
  FileCode2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Undo2,
} from 'lucide-react';

import { ScheduledTaskMenu, ScheduledTaskMenuItem } from '@/modules/scheduled-tasks';
import { ComposerToggleButton, EditorToolButton } from '@/modules/artefacts/editor/ArtefactEditorFrame';

type DocToolbarProps = {
  editor: Editor | null;
  /** Off while Claude is editing the document. */
  disabled: boolean;
  composerOpen: boolean;
  onToggleComposer: () => void;
};

type TextStyle = 'paragraph' | 'heading1' | 'heading2' | 'heading3';
const TEXT_STYLES: TextStyle[] = ['paragraph', 'heading1', 'heading2', 'heading3'];

/** Rendered by DocumentEditor under its composer: formatting in the spreadsheet toolbar's style. */
export default function DocToolbar({ editor, disabled, composerOpen, onToggleComposer }: DocToolbarProps) {
  const { t } = useTranslation('sidebar');
  // What the cursor is in, so buttons show as pressed; re-read only when it changes.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      return {
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        strike: current.isActive('strike'),
        code: current.isActive('code'),
        link: current.isActive('link'),
        bulletList: current.isActive('bulletList'),
        orderedList: current.isActive('orderedList'),
        taskList: current.isActive('taskList'),
        blockquote: current.isActive('blockquote'),
        codeBlock: current.isActive('codeBlock'),
        textStyle: (current.isActive('heading', { level: 1 }) ? 'heading1'
          : current.isActive('heading', { level: 2 }) ? 'heading2'
            : current.isActive('heading', { level: 3 }) ? 'heading3'
              : 'paragraph') as TextStyle,
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
      };
    },
  });

  const off = disabled || !editor;
  const chain = () => editor!.chain().focus();

  const setTextStyle = (style: TextStyle) => {
    if (!editor) return;
    if (style === 'paragraph') chain().setParagraph().run();
    else chain().toggleHeading({ level: Number(style.slice(-1)) as 1 | 2 | 3 }).run();
  };

  const editLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt(t('artefacts.docEditor.toolbar.linkPrompt'), previous ?? 'https://');
    if (href === null) return;
    if (!href.trim()) chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  return (
    <div className="sheet-toolbar" role="toolbar" aria-label={t('artefacts.editor.toolbar.label')}>
      <ScheduledTaskMenu
        triggerClassName="sheet-tool doc-tool-style"
        ariaLabel={t('artefacts.docEditor.toolbar.textStyle')}
        title={t('artefacts.docEditor.toolbar.textStyle')}
        trigger={<><span>{t(`artefacts.docEditor.toolbar.${state?.textStyle ?? 'paragraph'}`)}</span><ChevronDown size={13} /></>}
      >
        {(close) => TEXT_STYLES.map((style) => (
          <ScheduledTaskMenuItem
            key={style}
            label={<span className={`doc-style-option doc-style-${style}`}>{t(`artefacts.docEditor.toolbar.${style}`)}</span>}
            selected={state?.textStyle === style}
            onSelect={() => { close(); if (!off) setTextStyle(style); }}
          />
        ))}
      </ScheduledTaskMenu>
      <span className="sheet-toolbar-divider" aria-hidden="true" />
      <EditorToolButton label={t('artefacts.editor.toolbar.bold')} disabled={off} active={state?.bold} onClick={() => chain().toggleBold().run()}><Bold size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.editor.toolbar.italic')} disabled={off} active={state?.italic} onClick={() => chain().toggleItalic().run()}><Italic size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.strike')} disabled={off} active={state?.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.code')} disabled={off} active={state?.code} onClick={() => chain().toggleCode().run()}><Code size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.link')} disabled={off} active={state?.link} onClick={editLink}><Link2 size={17} /></EditorToolButton>
      <span className="sheet-toolbar-divider" aria-hidden="true" />
      <EditorToolButton label={t('artefacts.docEditor.toolbar.bulletList')} disabled={off} active={state?.bulletList} onClick={() => chain().toggleBulletList().run()}><List size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.orderedList')} disabled={off} active={state?.orderedList} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.taskList')} disabled={off} active={state?.taskList} onClick={() => chain().toggleTaskList().run()}><ListChecks size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.quote')} disabled={off} active={state?.blockquote} onClick={() => chain().toggleBlockquote().run()}><Quote size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.codeBlock')} disabled={off} active={state?.codeBlock} onClick={() => chain().toggleCodeBlock().run()}><FileCode2 size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.table')} disabled={off}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.docEditor.toolbar.divider')} disabled={off} onClick={() => chain().setHorizontalRule().run()}><Minus size={17} /></EditorToolButton>
      <span className="sheet-toolbar-divider" aria-hidden="true" />
      <EditorToolButton label={t('artefacts.editor.toolbar.undo')} disabled={off || !state?.canUndo} onClick={() => chain().undo().run()}><Undo2 size={17} /></EditorToolButton>
      <EditorToolButton label={t('artefacts.editor.toolbar.redo')} disabled={off || !state?.canRedo} onClick={() => chain().redo().run()}><Redo2 size={17} /></EditorToolButton>
      <ComposerToggleButton open={composerOpen} onToggle={onToggleComposer} />
    </div>
  );
}
