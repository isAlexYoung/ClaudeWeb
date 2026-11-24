import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { readStoredUiPreferences } from '@/shared/uiPreferences';
import type { ArtefactDetail, ArtefactState } from '@/shared/types';
import { kindTextKey } from '@/modules/artefacts/editor/kindText';
import { notifyArtefactsChanged, readArtefactResponse } from '@/modules/artefacts/useArtefacts';
import type { EditableArtefactKind } from '@/modules/artefacts/useArtefacts';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** What every artefact editor receives from WorkspaceMain (the same props SpreadsheetEditor takes). */
export type ArtefactEditorProps = {
  artefactId: string;
  /** The mobile menu button, shown before the title on small screens. */
  menuButton?: ReactNode;
  /** Back to the Artefacts list or closes the split pane back to full Chat. */
  onClose: () => void;
  /** Minimizes the artefact into its dedicated Chat conversation (showing the card at the top). */
  onMinimize?: (sessionId: string) => void;
  /** Opens the artefact's conversation in the full chat. */
  onOpenSession: (sessionId: string) => void;
  /** Mounted inside WorkspaceMain's split view alongside the real main ChatInterface. */
  embeddedSplit?: boolean;
  /** External split conversation visibility (when embeddedSplit is true). */
  chatOpen?: boolean;
  /** Toggles the external split ChatInterface panel (when embeddedSplit is true). */
  onToggleChat?: () => void;
  /** True while the split-pane width transition is animating. */
  splitAnimating?: boolean;
  /** Live processing state from the paired main ChatInterface. */
  externalRunning?: boolean;
  /** Sends a prompt directly through the paired live ChatInterface so it streams immediately on the right. */
  onSendChatMessage?: (text: string) => Promise<boolean>;
  /** Registers a callback so empty-state prompt pills in the paired ChatInterface can fill this composer. */
  registerFillComposer?: (fill: ((prompt: string) => void) | null) => void;
  /** Notifies WorkspaceMain once the artefact's linked sessionId is loaded. */
  onSessionResolved?: (sessionId: string) => void;
};

type FileSyncOptions<C> = Pick<
  ArtefactEditorProps,
  'artefactId' | 'onClose' | 'onMinimize' | 'embeddedSplit' | 'chatOpen' | 'onToggleChat'
  | 'externalRunning' | 'onSendChatMessage' | 'registerFillComposer' | 'onSessionResolved'
> & {
  kind: Exclude<EditableArtefactKind, 'sheet'>;
  /** The file's content as the text compared between saves (Markdown, or a scene's JSON). */
  toText: (content: C) => string;
  /** The content sent to the API for a saved text. */
  fromText: (text: string) => C;
  /** Reads the file's content out of the API's detail; null when the detail holds none. */
  readContent: (detail: ArtefactDetail) => C | null;
  /**
   * Shows a (re)loaded file in the editor. `initial` is true for the first
   * load; later loads are Claude's changes or a refused save.
   */
  onLoaded: (content: C, initial: boolean) => void;
};

const SAVE_DELAY_MS = 800;
const POLL_RUNNING_MS = 1500;
const POLL_IDLE_MS = 4000;
const NOTICE_MS = 3200;
const ERROR_NOTICE_MS = 8000;

function readStoredPreferenceValue(key: string): string | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const value = localStorage.getItem(key)?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Used by DocumentEditor and WhiteboardEditor: everything about an open
 * artefact that is not the editing surface, behaving exactly as the
 * spreadsheet editor does. The file on the server is the source of truth:
 * changes save shortly after they are made, Claude's edits reload the
 * editor, and while Claude works nothing is saved over its run.
 */
export function useArtefactFileSync<C>(options: FileSyncOptions<C>) {
  const {
    artefactId, kind, onClose, onMinimize, embeddedSplit = false, chatOpen, onToggleChat,
    externalRunning = false, onSendChatMessage, registerFillComposer,
  } = options;
  const { t } = useTranslation('sidebar');
  // The latest option callbacks, so effects and saves never use a stale one.
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const [detail, setDetail] = useState<ArtefactDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // A short line above the composer: a reload, an invalid file, a failed run.
  const [notice, setNotice] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(true);
  const [localConversationOpen, setLocalConversationOpen] = useState(false);
  const conversationOpen = embeddedSplit ? Boolean(chatOpen) : localConversationOpen;
  const effectiveRunning = running || externalRunning;
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const composerInputRef = useRef<HTMLInputElement | null>(null);
  // The revision of the file the editor shows, and its text as last saved or loaded.
  const revisionRef = useRef<string | null>(null);
  const savedTextRef = useRef<string | null>(null);
  // Text changed in the editor and not yet saved.
  const pendingTextRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const loadedOnceRef = useRef(false);
  const runningRef = useRef(false);
  useEffect(() => { runningRef.current = effectiveRunning; }, [effectiveRunning]);

  const noticeDurationRef = useRef(NOTICE_MS);
  const showNotice = useCallback((text: string, durationMs = NOTICE_MS) => {
    noticeDurationRef.current = durationMs;
    setNotice(text);
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), noticeDurationRef.current);
    return () => clearTimeout(timer);
  }, [notice]);

  const applyDetail = useCallback((next: ArtefactDetail) => {
    setDetail(next);
    setSessionId(next.sessionId);
    if (next.sessionId) optionsRef.current.onSessionResolved?.(next.sessionId);
    notifyArtefactsChanged({ upsert: next });
    revisionRef.current = next.revision;
    const content = optionsRef.current.readContent(next);
    if (content !== null) {
      savedTextRef.current = optionsRef.current.toText(content);
      pendingTextRef.current = null;
      const initial = !loadedOnceRef.current;
      loadedOnceRef.current = true;
      optionsRef.current.onLoaded(content, initial);
    } else if (next.contentError) {
      // The editor keeps the last good contents; the next save repairs the file.
      showNotice(t('artefacts.editor.invalidFile', { error: next.contentError }));
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
    if (text === null || !revisionRef.current || runningRef.current) return;
    if (savingRef.current) {
      await savingRef.current;
      return;
    }
    const work = (async () => {
      setSaveState('saving');
      try {
        const result = await readArtefactResponse<{ revision: string }>(
          await api.artefacts.saveContent(artefactId, { content: optionsRef.current.fromText(text), baseRevision: revisionRef.current! }),
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
          showNotice(t(kindTextKey(kind, 'reloaded')));
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
  }, [artefactId, kind, reload, showNotice, t]);

  /** Records the editor's current content; it is saved shortly after the last change. */
  const markChanged = useCallback((content: C) => {
    if (runningRef.current) return;
    const text = optionsRef.current.toText(content);
    // Editors report their initial render and selection changes too; only real changes are saved.
    if (text === savedTextRef.current || text === pendingTextRef.current) return;
    pendingTextRef.current = text;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

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
        setLastError(state.running ? null : state.lastError);
        if (wasRunning && !state.running && state.lastError) {
          showNotice(t('artefacts.editor.failed', { error: state.lastError }), ERROR_NOTICE_MS);
        }
        const changed = Boolean(revisionRef.current) && state.revision !== revisionRef.current;
        if (changed || (wasRunning && !state.running)) {
          if (pendingTextRef.current !== null && !state.running) await save();
          else if (changed) await reload();
        }
        wasRunning = state.running;
      } catch {
        // The next poll tries again.
      }
    };
    const timer = setInterval(() => void poll(), effectiveRunning ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [artefactId, effectiveRunning, reload, save, showNotice, t]);

  // Reload promptly as soon as the paired ChatInterface finishes a turn so
  // Claude's changes appear without waiting for the next poll tick.
  const prevExternalRunningRef = useRef(externalRunning);
  useEffect(() => {
    const wasRunning = prevExternalRunningRef.current;
    prevExternalRunningRef.current = externalRunning;
    if (!wasRunning || externalRunning) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const state = await readArtefactResponse<ArtefactState>(await api.artefacts.state(artefactId));
        if (cancelled) return;
        setRunning(state.running);
        setSessionId(state.sessionId);
        setLastError(state.running ? null : state.lastError);
        const changed = Boolean(revisionRef.current) && state.revision !== revisionRef.current;
        if (changed) await reload();
      } catch {
        // The regular poll loop will retry.
      }
    })();
    return () => { cancelled = true; };
  }, [artefactId, externalRunning, reload]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending || effectiveRunning || !detail) return;
    setSending(true);
    try {
      await save();
      if (onSendChatMessage) {
        const sent = await onSendChatMessage(text);
        if (sent) {
          setLastError(null);
          // Set now, not after the next render: an edit in between must not be saved over Claude's run.
          runningRef.current = true;
          setRunning(true);
          setMessage('');
          return;
        }
      }
      const model = readStoredPreferenceValue('claude-model');
      const effort = readStoredPreferenceValue('claude-effort');
      const mcpEnabled = readStoredUiPreferences().chatMcpEnabled;
      const result = await readArtefactResponse<{ sessionId: string }>(await api.artefacts.sendMessage(artefactId, {
        text,
        sessionTitle: t(kindTextKey(kind, 'sessionTitle'), { title: detail.title }),
        ...(model ? { model } : {}),
        ...(effort && effort !== 'default' ? { effort } : {}),
        mcpEnabled,
      }));
      setSessionId(result.sessionId);
      setLastError(null);
      runningRef.current = true;
      setRunning(true);
      setMessage('');
    } catch (caught) {
      const errorMessage = caught instanceof Error ? caught.message : String(caught);
      setLastError(errorMessage);
      showNotice(t('artefacts.editor.sendFailed', { error: errorMessage }), ERROR_NOTICE_MS);
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
      notifyArtefactsChanged({ upsert: updated });
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const remove = async () => {
    if (!detail || !window.confirm(t('artefacts.deleteConfirm', { title: detail.title }))) return;
    pendingTextRef.current = null;
    try {
      await readArtefactResponse<unknown>(await api.artefacts.remove(artefactId));
      notifyArtefactsChanged({ removeId: artefactId });
      onClose();
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const minimize = async () => {
    await save();
    if (embeddedSplit) {
      onClose();
      return;
    }
    if (sessionId && onMinimize) onMinimize(sessionId);
    else onClose();
  };

  const toggleConversation = () => {
    if (embeddedSplit && onToggleChat) onToggleChat();
    else setLocalConversationOpen((value) => !value);
  };

  const selectSuggestion = useCallback((prompt: string) => {
    setComposerOpen(true);
    setMessage(prompt);
    requestAnimationFrame(() => {
      const input = composerInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(prompt.length, prompt.length);
    });
  }, []);

  useEffect(() => {
    if (!registerFillComposer) return undefined;
    registerFillComposer(selectSuggestion);
    return () => registerFillComposer(null);
  }, [registerFillComposer, selectSuggestion]);

  /** The editor's content as the server will hold it after pending changes are saved. */
  const currentText = useCallback(() => pendingTextRef.current ?? savedTextRef.current, []);

  return {
    kind,
    detail,
    loadError,
    saveState,
    notice,
    showNotice,
    lastError,
    running: effectiveRunning,
    sessionId,
    composerOpen,
    setComposerOpen,
    conversationOpen,
    toggleConversation,
    message,
    setMessage,
    sending,
    send,
    titleDraft,
    setTitleDraft,
    rename,
    remove,
    minimize,
    save,
    markChanged,
    selectSuggestion,
    currentText,
    composerInputRef: composerInputRef as RefObject<HTMLInputElement>,
  };
}

export type ArtefactFileSync = ReturnType<typeof useArtefactFileSync<unknown>>;
