import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { ArrowUp, ChevronDown, Loader2, PanelRight, Sheet, X } from 'lucide-react';

import { ScheduledTaskMenu, ScheduledTaskMenuDivider, ScheduledTaskMenuItem } from '@/modules/scheduled-tasks';
import { api } from '@/shared/api';
import type { ArtefactDetail, ArtefactState, SheetDocument } from '@/shared/types';
import { formulaOrder, fromGridSheets, sheetToCsv, toGridSheets } from '@/modules/artefacts/sheet/sheetFormat';
import type { GridSheet } from '@/modules/artefacts/sheet/sheetFormat';
import SheetConversation from '@/modules/artefacts/sheet/SheetConversation';
import SheetToolbar from '@/modules/artefacts/sheet/SheetToolbar';
import type { ToolbarWorkbook } from '@/modules/artefacts/sheet/SheetToolbar';
import { readArtefactResponse } from '@/modules/artefacts/useArtefacts';

type SpreadsheetEditorProps = {
  artefactId: string;
  /** The mobile menu button, shown before the title on small screens. */
  menuButton?: ReactNode;
  /** Back to the Artefacts list. */
  onClose: () => void;
  /** Opens the spreadsheet's conversation in the full chat. */
  onOpenSession: (sessionId: string) => void;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 800;
const POLL_RUNNING_MS = 1500;
const POLL_IDLE_MS = 4000;
const NOTICE_MS = 3200;

/** FortuneSheet's language code for the interface language. */
function gridLanguage(language: string): string {
  if (/^zh-(tw|hk|hant)/i.test(language)) return 'zh_tw';
  if (/^zh/i.test(language)) return 'zh';
  return 'en';
}

/**
 * Rendered by WorkspaceMain (lazily, with FortuneSheet) when a spreadsheet is
 * opened from the Artefacts page. The file on the server is the source of
 * truth: the grid saves to it shortly after each change, and reloads it when
 * Claude has changed it. While Claude works, the grid is read-only so the two
 * never write over each other.
 */
export default function SpreadsheetEditor({ artefactId, menuButton, onClose, onOpenSession }: SpreadsheetEditorProps) {
  const { t, i18n } = useTranslation('sidebar');
  const [detail, setDetail] = useState<ArtefactDetail | null>(null);
  // The workbook handed to FortuneSheet; replaced (with a new key) when the file is reloaded.
  const [gridData, setGridData] = useState<GridSheet[] | null>(null);
  const [gridKey, setGridKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // A short line above the composer: a reload, an invalid file, a failed run.
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const workbookRef = useRef<ToolbarWorkbook | null>(null);
  // The revision of the file the grid shows, and its contents as last saved or loaded.
  const revisionRef = useRef<string | null>(null);
  const savedTextRef = useRef<string | null>(null);
  // Contents changed in the grid and not yet saved.
  const pendingTextRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const runningRef = useRef(false);
  useEffect(() => { runningRef.current = running; }, [running]);

  const showNotice = useCallback((text: string) => setNotice(text), []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const applyDetail = useCallback((next: ArtefactDetail) => {
    setDetail(next);
    setSessionId(next.sessionId);
    revisionRef.current = next.revision;
    if (next.content) {
      savedTextRef.current = JSON.stringify(next.content);
      pendingTextRef.current = null;
      setGridData(toGridSheets(next.content));
      setGridKey((key) => key + 1);
    } else if (next.contentError) {
      // The grid keeps the last good contents; the next save repairs the file.
      showNotice(t('artefacts.editor.invalidFile', { error: next.contentError }));
      setGridData((current) => current ?? toGridSheets({ format: 'claudeweb-sheet@1', sheets: [{ name: 'Sheet1', cells: {} }] }));
    }
  }, [showNotice, t]);

  const reload = useCallback(async () => {
    try {
      const next = await readArtefactResponse<ArtefactDetail>(await api.artefacts.open(artefactId));
      applyDetail(next);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [applyDetail, artefactId]);

  // The file is read once the editor has mounted.
  useEffect(() => { queueMicrotask(() => void reload()); }, [reload]);

  const save = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const text = pendingTextRef.current;
    if (!text || !revisionRef.current || runningRef.current) return;
    if (savingRef.current) {
      await savingRef.current;
      return;
    }
    const work = (async () => {
      setSaveState('saving');
      try {
        const result = await readArtefactResponse<{ revision: string }>(
          await api.artefacts.saveContent(artefactId, { content: JSON.parse(text) as SheetDocument, baseRevision: revisionRef.current! }),
        );
        revisionRef.current = result.revision;
        savedTextRef.current = text;
        if (pendingTextRef.current === text) pendingTextRef.current = null;
        setSaveState('saved');
      } catch (caught) {
        const status = (caught as { status?: number }).status;
        if (status === 409) {
          // Claude changed the file meanwhile: its version wins.
          pendingTextRef.current = null;
          setSaveState('idle');
          showNotice(t('artefacts.editor.reloaded'));
          await reload();
        } else {
          setSaveState('error');
          showNotice(t('artefacts.editor.saveFailed', { error: caught instanceof Error ? caught.message : String(caught) }));
        }
      }
    })();
    savingRef.current = work;
    try {
      await work;
    } finally {
      savingRef.current = null;
    }
  }, [artefactId, reload, showNotice, t]);

  const onGridChange = useCallback((sheets: GridSheet[]) => {
    if (runningRef.current) return;
    const text = JSON.stringify(fromGridSheets(sheets));
    // FortuneSheet reports its initial render too; only real changes are saved.
    if (text === savedTextRef.current || text === pendingTextRef.current) return;
    pendingTextRef.current = text;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  // FortuneSheet 1.0.4 does not compute formulas in the data it is handed (its
  // forceCalculation option is unused), so each freshly mounted grid computes them.
  // Its own pass goes row by row, and a formula reading a formula further down
  // (C3 = B3/B8, B8 = SUM(...)) would get an error and lose its number format;
  // so each sheet's formulas are computed one by one, after what they read.
  useEffect(() => {
    if (!gridData) return undefined;
    const timer = setTimeout(() => {
      const workbook = workbookRef.current;
      if (!workbook) return;
      for (const sheet of gridData) {
        for (const { r, c } of formulaOrder(sheet)) workbook.calculateFormula(sheet.id, { row: [r, r], column: [c, c] });
      }
      // Formulas reading other sheets settle on a last pass over the whole workbook.
      workbook.calculateFormula();
    }, 0);
    return () => clearTimeout(timer);
  }, [gridData, gridKey]);

  // Leaving the editor saves what is still pending.
  useEffect(() => () => { void save(); }, [save]);

  // Follows the file and Claude's run: often while it runs, now and then otherwise
  // (Claude may also edit the file from the full chat).
  useEffect(() => {
    let cancelled = false;
    let wasRunning = runningRef.current;
    const poll = async () => {
      try {
        const state = await readArtefactResponse<ArtefactState>(await api.artefacts.state(artefactId));
        if (cancelled) return;
        setRunning(state.running);
        setSessionId(state.sessionId);
        if (wasRunning && !state.running && state.lastError) {
          showNotice(t('artefacts.editor.failed', { error: state.lastError }));
        }
        const changed = Boolean(revisionRef.current) && state.revision !== revisionRef.current;
        if (changed || (wasRunning && !state.running)) {
          if (pendingTextRef.current && !state.running) await save();
          else if (changed) await reload();
        }
        wasRunning = state.running;
      } catch {
        // The next poll tries again.
      }
    };
    const timer = setInterval(() => void poll(), running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [artefactId, reload, running, save, showNotice, t]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending || running || !detail) return;
    setSending(true);
    try {
      await save();
      const result = await readArtefactResponse<{ sessionId: string }>(await api.artefacts.sendMessage(artefactId, {
        text,
        sessionTitle: t('artefacts.editor.sessionTitle', { title: detail.title }),
      }));
      setSessionId(result.sessionId);
      // Set now, not after the next render: a grid change in between must not be saved over Claude's run.
      runningRef.current = true;
      setRunning(true);
      setMessage('');
    } catch (caught) {
      showNotice(t('artefacts.editor.sendFailed', { error: caught instanceof Error ? caught.message : String(caught) }));
    } finally {
      setSending(false);
    }
  };

  const rename = async (title: string) => {
    setTitleDraft(null);
    const trimmed = title.trim();
    if (!detail || !trimmed || trimmed === detail.title) return;
    try {
      const updated = await readArtefactResponse<ArtefactDetail>(await api.artefacts.update(artefactId, { title: trimmed }));
      setDetail((current) => current && { ...current, title: updated.title });
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const remove = async () => {
    if (!detail || !window.confirm(t('artefacts.deleteConfirm', { title: detail.title }))) return;
    pendingTextRef.current = null;
    try {
      await readArtefactResponse<unknown>(await api.artefacts.remove(artefactId));
      onClose();
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const downloadCsv = () => {
    const text = pendingTextRef.current ?? savedTextRef.current;
    if (!text || !detail) return;
    const document = JSON.parse(text) as SheetDocument;
    const blob = new Blob([`﻿${sheetToCsv(document.sheets[0])}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(window.document.createElement('a'), { href: url, download: `${detail.title}.csv` });
    link.click();
    URL.revokeObjectURL(url);
  };

  const close = async () => {
    await save();
    onClose();
  };

  if (loadError && !detail) {
    return (
      <div className="workspace-main sheet-editor flex h-full flex-col">
        <div className="sheet-editor-head">{menuButton}<button type="button" className="artefact-icon-button" onClick={onClose} aria-label={t('artefacts.editor.close')}><X size={18} /></button></div>
        <p role="alert" className="artefacts-status">{t('artefacts.editor.loadFailed', { error: loadError })}</p>
      </div>
    );
  }

  return (
    <div className="workspace-main sheet-editor flex h-full flex-col">
      <div className="sheet-editor-head">
        {menuButton}
        {titleDraft !== null ? (
          <input
            className="sheet-editor-title-input"
            value={titleDraft}
            maxLength={120}
            autoFocus
            aria-label={t('artefacts.renameTitle')}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => void rename(titleDraft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void rename(titleDraft);
              if (event.key === 'Escape') setTitleDraft(null);
            }}
          />
        ) : (
          <ScheduledTaskMenu
            triggerClassName="sheet-editor-title"
            ariaLabel={t('artefacts.editor.titleMenu')}
            trigger={<><span>{detail?.title ?? ''}</span><ChevronDown size={15} /></>}
          >
            {(closeMenu) => (
              <>
                <ScheduledTaskMenuItem label={t('artefacts.rename')} onSelect={() => { closeMenu(); setTitleDraft(detail?.title ?? ''); }} />
                <ScheduledTaskMenuItem label={t('artefacts.editor.downloadCsv')} onSelect={() => { closeMenu(); downloadCsv(); }} />
                <ScheduledTaskMenuDivider />
                <ScheduledTaskMenuItem label={t('artefacts.delete')} danger onSelect={() => { closeMenu(); void remove(); }} />
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
            className={`sheet-editor-head-button ${conversationOpen ? 'active' : ''}`}
            aria-pressed={conversationOpen}
            onClick={() => setConversationOpen((value) => !value)}
          >
            <PanelRight size={16} />
            {conversationOpen ? t('artefacts.editor.hideConversation') : t('artefacts.editor.showConversation')}
          </button>
          <button type="button" className="artefact-icon-button" aria-label={t('artefacts.editor.close')} title={t('artefacts.editor.close')} onClick={() => void close()}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="sheet-editor-body">
        <div className="sheet-editor-grid">
          {gridData ? (
            <Workbook
              key={gridKey}
              ref={workbookRef as never}
              data={gridData as never}
              onChange={onGridChange as never}
              showToolbar={false}
              showFormulaBar
              showSheetTabs
              lang={gridLanguage(i18n.language)}
            />
          ) : (
            <p role="status" className="artefacts-status">{t('artefacts.loading')}</p>
          )}
          {running && (
            // Claude owns the file until its run ends; the grid only shows it.
            <div className="sheet-editor-lock" aria-hidden="true" />
          )}

          <div className="sheet-editor-floating">
            {notice && <p role="status" className="sheet-editor-notice">{notice}</p>}
            {composerOpen && (
              <form className="sheet-composer" onSubmit={(event) => void send(event)}>
                <span className="sheet-composer-chip">
                  <Sheet size={13} />
                  <strong>{detail?.title ?? ''}</strong>
                  <span>{t('artefacts.kinds.sheet')}</span>
                </span>
                <div className="sheet-composer-row">
                  {running ? (
                    <p className="sheet-composer-working" role="status"><Loader2 size={15} className="animate-spin" />{t('artefacts.editor.working')}</p>
                  ) : (
                    <input
                      value={message}
                      placeholder={t('artefacts.editor.composerPlaceholder')}
                      aria-label={t('artefacts.editor.composerPlaceholder')}
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
            <SheetToolbar
              getWorkbook={() => workbookRef.current}
              disabled={running}
              composerOpen={composerOpen}
              onToggleComposer={() => setComposerOpen((value) => !value)}
            />
          </div>
        </div>
        {conversationOpen && (
          <SheetConversation
            sessionId={sessionId}
            running={running}
            onClose={() => setConversationOpen(false)}
            onOpenInChat={(id) => { void save().then(() => onOpenSession(id)); }}
          />
        )}
      </div>
    </div>
  );
}
