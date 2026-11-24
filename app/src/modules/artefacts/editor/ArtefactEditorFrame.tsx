import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ChevronDown, Loader2, Maximize2, MessageCircle, Minimize2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { ScheduledTaskMenu, ScheduledTaskMenuDivider, ScheduledTaskMenuItem } from '@/modules/scheduled-tasks';
import { kindTextKey } from '@/modules/artefacts/editor/kindText';
import type { useArtefactFileSync } from '@/modules/artefacts/editor/useArtefactFileSync';
import SheetConversation from '@/modules/artefacts/sheet/SheetConversation';

type FileSync = ReturnType<typeof useArtefactFileSync<never>>;

/** One button of a floating editor toolbar; looks and behaves like the spreadsheet's. */
export function EditorToolButton({ label, onClick, disabled = false, active = false, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shown pressed, e.g. bold while the cursor is in bold text. */
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="sheet-tool"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      data-open={active ? 'true' : undefined}
      disabled={disabled}
      // Keeps the editor's selection: a toolbar click must not take focus from it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The toolbar's "Chat" button, which shows or hides the composer above it. */
export function ComposerToggleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation('sidebar');
  return (
    <button
      type="button"
      className={`sheet-toolbar-chat ${open ? 'active' : ''}`}
      aria-pressed={open}
      onClick={onToggle}
    >
      <MessageCircle size={15} />
      {t('artefacts.editor.toolbar.chat')}
    </button>
  );
}

type ArtefactEditorFrameProps = {
  sync: FileSync;
  /** The kind's icon, shown on the composer's chip. */
  icon: LucideIcon;
  menuButton?: ReactNode;
  /** Mounted beside the live Chat in WorkspaceMain's split view (no drawer of its own). */
  embeddedSplit?: boolean;
  onOpenSession: (sessionId: string) => void;
  /** Kind-specific title menu items (downloads), shown between Rename and Delete. */
  titleMenuItems?: (closeMenu: () => void) => ReactNode;
  /** The editing surface. */
  children: ReactNode;
  surfaceClassName: string;
  surfaceRef?: Ref<HTMLDivElement>;
  /** The floating toolbar; defaults to one holding only the Chat button. */
  toolbar?: ReactNode;
};

/**
 * The frame every non-spreadsheet artefact editor shares with
 * SpreadsheetEditor: the head (title menu, save state, conversation toggle,
 * minimize), the editing surface, the floating composer and toolbar, and —
 * outside the split view — the conversation drawer. Same markup and classes,
 * so all editors look and move alike.
 */
export default function ArtefactEditorFrame({
  sync,
  icon: Icon,
  menuButton,
  embeddedSplit = false,
  onOpenSession,
  titleMenuItems,
  children,
  surfaceClassName,
  surfaceRef,
  toolbar,
}: ArtefactEditorFrameProps) {
  const { t } = useTranslation('sidebar');
  const {
    kind, detail, saveState, notice, running, composerOpen, conversationOpen, titleDraft,
    composerInputRef, message, sending, setMessage, send, setComposerOpen,
  } = sync;

  if (sync.loadError && !detail) {
    return (
      <div className={`workspace-main sheet-editor artefact-editor artefact-kind-${kind} flex h-full flex-col`}>
        <div className="sheet-editor-head">
          {menuButton}
          <button type="button" className="artefact-icon-button" onClick={() => void sync.minimize()} aria-label={t('artefacts.editor.close')}><X size={18} /></button>
        </div>
        <p role="alert" className="artefacts-status">{t(kindTextKey(kind, 'loadFailed'), { error: sync.loadError })}</p>
      </div>
    );
  }

  return (
    <div className={`workspace-main sheet-editor artefact-editor artefact-kind-${kind} flex h-full flex-col`}>
      <div className="sheet-editor-head">
        {menuButton}
        {titleDraft !== null ? (
          <input
            className="sheet-editor-title-input"
            value={titleDraft}
            maxLength={120}
            autoFocus
            aria-label={t('artefacts.renameTitle')}
            onChange={(event) => sync.setTitleDraft(event.target.value)}
            onBlur={() => void sync.rename(titleDraft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void sync.rename(titleDraft);
              if (event.key === 'Escape') sync.setTitleDraft(null);
            }}
          />
        ) : (
          <ScheduledTaskMenu
            triggerClassName="sheet-editor-title"
            ariaLabel={t(kindTextKey(kind, 'titleMenu'))}
            trigger={<><span>{detail?.title ?? ''}</span><ChevronDown size={15} /></>}
          >
            {(closeMenu) => (
              <>
                <ScheduledTaskMenuItem label={t('artefacts.rename')} onSelect={() => { closeMenu(); sync.setTitleDraft(detail?.title ?? ''); }} />
                {titleMenuItems?.(closeMenu)}
                <ScheduledTaskMenuDivider />
                <ScheduledTaskMenuItem label={t('artefacts.delete')} danger onSelect={() => { closeMenu(); void sync.remove(); }} />
              </>
            )}
          </ScheduledTaskMenu>
        )}
        <span className="sheet-editor-save" role="status" aria-live="polite">
          {saveState === 'saving' ? t('artefacts.editor.saving') : saveState === 'saved' ? t('artefacts.editor.saved') : ''}
        </span>
        <div className="sheet-editor-head-actions">
          <button
            type="button"
            className="artefact-icon-button"
            aria-pressed={conversationOpen}
            data-open={conversationOpen ? 'true' : undefined}
            aria-label={conversationOpen ? t('artefacts.editor.hideConversation') : t('artefacts.editor.showConversation')}
            title={conversationOpen ? t('artefacts.editor.hideConversation') : t('artefacts.editor.showConversation')}
            onClick={sync.toggleConversation}
          >
            {conversationOpen ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
          </button>
          <button
            type="button"
            className="artefact-icon-button"
            aria-label={t('artefacts.editor.minimize')}
            title={t('artefacts.editor.minimize')}
            onClick={() => void sync.minimize()}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="sheet-editor-body">
        <div ref={surfaceRef} className={`sheet-editor-grid ${surfaceClassName}`} data-readonly={running ? 'true' : undefined}>
          {children}

          <div className="sheet-editor-floating">
            {notice && <p role="status" className="sheet-editor-notice">{notice}</p>}
            {composerOpen && (
              <form className="sheet-composer" onSubmit={(event) => void send(event)}>
                <span className="sheet-composer-chip">
                  <Icon size={13} />
                  <strong>{detail?.title ?? ''}</strong>
                  <span>{t(`artefacts.kinds.${kind}`)}</span>
                </span>
                <div className="sheet-composer-row">
                  {running ? (
                    <p className="sheet-composer-working" role="status"><Loader2 size={15} className="animate-spin" />{t(kindTextKey(kind, 'working'))}</p>
                  ) : (
                    <input
                      ref={composerInputRef}
                      value={message}
                      placeholder={t(kindTextKey(kind, 'composerPlaceholder'))}
                      aria-label={t(kindTextKey(kind, 'composerPlaceholder'))}
                      disabled={sending}
                      onChange={(event) => setMessage(event.target.value)}
                    />
                  )}
                  <button type="submit" className="sheet-composer-send" aria-label={t('artefacts.editor.send')} title={t('artefacts.editor.send')}
                    disabled={!message.trim() || sending || running}>
                    <ArrowUp size={16} />
                  </button>
                </div>
              </form>
            )}
            {toolbar ?? (
              <div className="sheet-toolbar sheet-toolbar-compact" role="toolbar" aria-label={t('artefacts.editor.toolbar.label')}>
                <ComposerToggleButton open={composerOpen} onToggle={() => setComposerOpen((value) => !value)} />
              </div>
            )}
          </div>
        </div>
        {!embeddedSplit && conversationOpen && (
          <SheetConversation
            kind={kind}
            sessionId={sync.sessionId}
            running={running}
            error={sync.lastError}
            onSelectSuggestion={sync.selectSuggestion}
            onOpenInChat={(id) => { void sync.save().then(() => onOpenSession(id)); }}
          />
        )}
      </div>
    </div>
  );
}
