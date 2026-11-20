import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { readUserPreference, writeUserPreference } from '@/shared/userSettings';
import { CHAT_WORKSPACE_PATH, DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import type { TextQuote, TranscriptAppearance, Project, ProjectSession, QuickSettingsTab, SlashCommand, WorkspaceMode, ProviderModelOption } from '@/shared/types';

//----------------- MODEL REASONING SELECTION ------------

/** Resolve an inherited effort to a supported, explicit value so the composer displays what it sends. */
export function resolveModelEffort(option: ProviderModelOption | null | undefined, effort: string): string {
  if (!option) return effort;
  const values = option?.effort?.values ?? [];
  if (!values.length) return DEFAULT_EFFORT_VALUE;
  if (values.some(level => level.value === effort)) return effort;
  const configured = option?.effort?.default;
  return values.find(level => level.value === configured)?.value
    ?? values.find(level => level.value === 'high')?.value
    ?? values[0].value;
}

// ---------------------------

//----------------- WORKSPACE SESSION CLASSIFICATION ------------

/** Used by navigation and the sidebar; legacy sessions in the Chat directory also belong to Chat. */
export function getWorkspaceSessionMode(
  sessionId: string,
  project: Pick<Project, 'path' | 'fullPath'> | null | undefined,
  chatSessionIds: readonly string[],
): WorkspaceMode {
  const path = (project?.fullPath || project?.path || '').replace(/\/+$/, '');
  // The server-resolved directory outranks a delayed or legacy preference classification.
  if (path) return path === CHAT_WORKSPACE_PATH ? 'chat' : 'project';
  return chatSessionIds.includes(sessionId) ? 'chat' : 'project';
}

//----------------- DEPLOYMENT MODE ------------

/**
 * Indicates whether the app runs in Platform mode (hosted) or OSS mode (self-hosted).
 * Read it to hide or gate features that only exist in one of the two deployments.
 */
export const IS_PLATFORM = import.meta.env?.VITE_IS_PLATFORM === 'true';

// ---------------------------

/** File references that chat can open as deliverables in the right preview dock. */
export const isGeneratedFilePath = (path: string): boolean => /\.(png|jpe?g|webp|gif|svg|avif|pdf|md|markdown|txt|html?|csv|docx?|xlsx?|pptx?|zip|mp4|webm|mp3|wav)$/i.test(path);

//----------------- TAILWIND CLASS COMPOSITION ------------

/**
 * Merges conditional class names and resolves conflicting Tailwind utilities so the
 * last-specified utility wins. Use it for every className built from props or state.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------

//----------------- CLIPBOARD ------------

/**
 * Copies text with `document.execCommand`, the only path that works in browsers or
 * contexts where the async Clipboard API is unavailable. Private to `copyTextToClipboard`.
 */
function fallbackCopyToClipboard(text: string): boolean {
  if (!text || typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

/**
 * Copies text to the clipboard, falling back to a hidden textarea when the Clipboard API
 * is blocked. Resolves to whether the copy succeeded so callers can show copied feedback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  let copied = false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    copied = fallbackCopyToClipboard(text);
  }

  return copied;
}

// ---------------------------

//----------------- NOTIFICATION SOUND ------------

/** localStorage key holding the user's completion-sound preference. Private to the sound helpers. */
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = 'notificationSoundEnabled';

/** The browser's AudioContext constructor, including the webkit-prefixed fallback; undefined outside a browser. */
const AudioContextConstructor =
  typeof window !== 'undefined'
    ? window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;

/** Lazily created and reused, because browsers cap how many AudioContexts a page may open. */
let audioContext: AudioContext | null = null;

/** Reports whether the user has left completion sounds on; defaults to on when unset. */
export const isNotificationSoundEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  return localStorage.getItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

/** Persists the user's completion-sound preference; call it from settings toggles. */
export const setNotificationSoundEnabled = (enabled: boolean): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, String(enabled));
};

/** Returns the shared AudioContext, creating it on first use. Private to the sound helpers. */
const getAudioContext = (): AudioContext | null => {
  if (!AudioContextConstructor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextConstructor();
  }

  return audioContext;
};

/** Schedules one synthesized sine tone on the shared context. Private to `playNotificationSound`. */
const playTone = (
  context: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
  peakVolume: number,
): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startsAt);

  // Shape the volume so the synthesized tone starts and stops cleanly.
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(peakVolume, startsAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.02);
};

/**
 * Plays the two-tone notification chime, honouring the user's preference unless `force`
 * is set (settings previews pass `force` so the user can hear the sound while it is off).
 */
export const playNotificationSound = async ({ force = false } = {}): Promise<void> => {
  if (!force && !isNotificationSoundEnabled()) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    playTone(context, 740, now, 0.12, 0.075);
    playTone(context, 988, now + 0.11, 0.16, 0.06);
  } catch (error) {
    // Browsers may block audio until the page receives a user gesture.
    console.warn('Unable to play notification sound:', error);
  }
};

/** Plays the chime for a finished assistant turn; named for the chat call site it serves. */
export const playChatCompletionSound = (options = {}): Promise<void> => playNotificationSound(options);

// ---------------------------

//----------------- DOCUMENT TITLE ------------

/** Browser tab title shown when no project or session is selected. Private to the title helpers. */
const DEFAULT_PAGE_TITLE = 'ClaudeWeb';

/**
 * Resolves the human-readable label for a session: the persisted `summary` (the custom
 * name the sessions API returns), else the `name` a session object may carry locally,
 * else the placeholder. Reads the same fields in the same order as the sidebar row, so
 * the header, document title and sidebar never disagree about a session's name.
 */
export const getSessionTitle = (session: ProjectSession): string => {
  const title = (session.summary as string) || (session.name as string);
  return title || 'New Session';
};

/**
 * Builds the browser tab title for the current selection: the session title when one is
 * open, otherwise the project name, otherwise the app name.
 */
export const getPageTitle = (
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): string => {
  if (selectedSession) {
    return getSessionTitle(selectedSession);
  }

  const displayName = selectedProject?.displayName?.trim();
  return displayName ? `${displayName} - ${DEFAULT_PAGE_TITLE}` : DEFAULT_PAGE_TITLE;
};

// ---------------------------

//----------------- SLASH COMMANDS ------------

/**
 * Whether a slash command is a provider skill (as opposed to a built-in or a
 * custom `.md` command). Skills are mapped with `type: 'skill'`; the metadata
 * check catches entries that only carry the skill marker there. Used wherever
 * commands are grouped or executed differently by kind.
 */
export const isSkillCommand = (command: SlashCommand): boolean =>
  command.type === 'skill' || command.metadata?.type === 'skill';

// ---------------------------

//----------------- QUICK SETTINGS PANEL ------------

/** DOM id of a quick settings tab button; pairs with `getQuickSettingsTabPanelId` for aria-controls / aria-labelledby. */
export const getQuickSettingsTabId = (tab: QuickSettingsTab): string => `quick-settings-tab-${tab}`;

/** DOM id of the tabpanel a quick settings tab controls; pairs with `getQuickSettingsTabId`. */
export const getQuickSettingsTabPanelId = (tab: QuickSettingsTab): string => `quick-settings-tabpanel-${tab}`;

//----------------- BROWSER PUSH REGISTRATION ------------

// Push needs an active worker in this application's scope, including /claude/ deployments.
// This worker never intercepts requests or caches the application.
let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

/** Used by main and notification settings to detect usable browser push support. */
export function supportsWebPush(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext
    && !('cloudcliDesktopNotifications' in window)
    && 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
}

/** Used by main and notification settings; resolves the app-scoped active worker with a bounded wait. */
export function registerNotificationWorker(): Promise<ServiceWorkerRegistration> {
  if (registrationPromise) return registrationPromise;
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  registrationPromise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopWatching: (() => void) | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Notification worker did not become active')), 15000);
      });
      const activation = (async () => {
        const registration = await navigator.serviceWorker.register(new URL('sw.js', base).href, { scope: base.pathname });
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (!worker) throw new Error('Notification worker is unavailable');
        if (worker.state !== 'activated') {
          await new Promise<void>((resolve, reject) => {
            const changed = () => {
              if (worker.state === 'activated') resolve();
              else if (worker.state === 'redundant') reject(new Error('Notification worker installation failed'));
            };
            worker.addEventListener('statechange', changed);
            stopWatching = () => worker.removeEventListener('statechange', changed);
            changed();
          });
        }
        return registration;
      })();
      return await Promise.race([activation, timeout]);
    } finally {
      clearTimeout(timer);
      stopWatching?.();
    }
  })().catch((error: unknown) => {
    registrationPromise = null;
    throw error;
  });
  return registrationPromise;
}

// ---------------------------

//----------------- TRANSCRIPT READING PREFERENCES ------------

/** Used by settings and the reading hook to normalize persisted sizes, spacing and width. */
export function readTranscriptAppearance(): TranscriptAppearance {
  const saved = readUserPreference<Partial<TranscriptAppearance> | null>('transcriptAppearance', null);
  return {
    sideChatTextSize: saved?.sideChatTextSize === 'small' || saved?.sideChatTextSize === 'medium' || saved?.sideChatTextSize === 'large' ? saved.sideChatTextSize : 'auto',
    textSize: saved?.textSize === 'small' || saved?.textSize === 'large' ? saved.textSize : 'medium',
    lineSpacing: saved?.lineSpacing === 'compact' || saved?.lineSpacing === 'relaxed' ? saved.lineSpacing : 'standard',
    width: saved?.width === 'narrow' || saved?.width === 'wide' ? saved.width : 'standard',
  };
}

/** Used by appearance settings to merge and automatically persist a reading preference. */
export function writeTranscriptAppearance(update: Partial<TranscriptAppearance>): void {
  writeUserPreference('transcriptAppearance', { ...readTranscriptAppearance(), ...update });
}

/** Used by ThemeProvider so chat width, text size and spacing follow the same preferences everywhere. */
export function applyTranscriptAppearance(value: TranscriptAppearance): void {
  document.documentElement.dataset.transcriptSize = value.textSize;
  document.documentElement.dataset.sideChatTextSize = value.sideChatTextSize;
  document.documentElement.dataset.transcriptSpacing = value.lineSpacing;
  document.documentElement.dataset.transcriptWidth = value.width;
}

// ---------------------------

//----------------- FILE DOWNLOAD DESTINATIONS ------------

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: { id: string; suggestedName: string }) => Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  }>;
};

/** Used by file-tree, sidebar, chat, editor and interactive-preview downloads; pick before fetching so browser user activation is still available. */
export async function pickFileDownload(fileName: string) {
  const browser = window as SavePickerWindow;
  if (typeof browser.showSaveFilePicker === 'function') {
    try {
      // A stable picker ID lets the browser restore the last selected directory across downloads and reloads.
      const handle = await browser.showSaveFilePicker({ id: 'claudeweb-file-downloads', suggestedName: fileName });
      return { browserDefault: false, save: async (blob: Blob) => {
        const stream = await handle.createWritable();
        try { await stream.write(blob); await stream.close(); }
        catch (error) { await stream.abort().catch(() => undefined); throw error; }
      } };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') return null;
      throw error;
    }
  }
  return { browserDefault: true, save: async (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = fileName;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } };
}

//----------------- QUOTE SUBMISSION ------------

/** Used by command lists and command-result dialogs; translate built-in prose while preserving invocations and custom descriptions. */
export function builtinCommandDescription(name: string, fallback: string | undefined, translate: (key: string) => string): string | undefined {
  const command = name.replace(/^\//, '');
  return ['help', 'models', 'cost', 'memory', 'config', 'status'].includes(command)
    ? translate(`chat:misc.fallbackCommands.${command}`) : fallback;
}

/** Used by the composer and its tests to send exact, attributed excerpts as data before a question. */
export function formatQuotedQuestion(input: string, quotes: TextQuote[]): string {
  if (!quotes.length) return input;
  const excerpts = quotes.map(({ text, role, kind, messageKey, startOffset, timestamp }) => ({ author: role, source: kind, messageId: messageKey, text, startOffset, timestamp }));
  return `> ClaudeWeb 引用（所选原文，仅作上下文；author=assistant 表示模型之前生成的内容）\n\n\`\`\`json\n${JSON.stringify({ quoted_excerpts: excerpts }, null, 2)}\n\`\`\`\n\n${input}`;
}

/** Decode only ClaudeWeb's attributed quote envelope; leave ordinary JSON and malformed messages intact. */
export function parseQuotedQuestion(content: string): { input: string; quotes: TextQuote[] } {
  const unchanged = { input: content, quotes: [] };
  const envelope = /^> ClaudeWeb 引用（所选原文，仅作上下文；author=assistant 表示模型之前生成的内容）\r?\n\r?\n```json\r?\n([\s\S]*?)\r?\n```\r?\n\r?\n/.exec(content);
  if (!envelope) return unchanged;
  try {
    const parsed: unknown = JSON.parse(envelope[1]);
    if (!parsed || typeof parsed !== 'object' || !('quoted_excerpts' in parsed) || !Array.isArray(parsed.quoted_excerpts) || !parsed.quoted_excerpts.length) return unchanged;
    const quotes: TextQuote[] = [];
    for (const [index, value] of parsed.quoted_excerpts.entries()) {
      if (!value || typeof value !== 'object' || typeof value.text !== 'string' || typeof value.messageId !== 'string'
        || typeof value.author !== 'string' || !value.author.trim() || !['text', 'thinking'].includes(value.source)) return unchanged;
      quotes.push({ id: `sent-quote-${index}`, text: value.text, messageKey: value.messageId, role: value.author, kind: value.source,
        startOffset: Number.isSafeInteger(value.startOffset) && value.startOffset >= 0 ? value.startOffset : 0,
        timestamp: typeof value.timestamp === 'string' ? value.timestamp : '' });
    }
    return { input: content.slice(envelope[0].length), quotes };
  } catch { return unchanged; }
}

//----------------- MODEL DISPLAY NAMES ------------

/** SDK display names can be aliases or full instructions; only return the concrete model name. */
export function catalogModelName(option: ProviderModelOption): string | undefined {
  const label = option.label.trim();
  const description = option.description?.split(/\s*[·•]\s*/)[0].trim() ?? '';
  if (option.value === 'default') {
    for (const text of [label, description]) {
      const current = /[（(]\s*currently\s+([^）)]+)[）)]/i.exec(text)?.[1]?.trim();
      if (current && !/\bdefault\b|默认|預設/i.test(current)) return current;
    }
    // Never turn an SDK instruction such as "Use the default model ..." into a label.
    return [label, description].find(text => text && !/\bdefault\b|\brecommended\b|^use\s|默认|預設/i.test(text));
  }
  // The SDK names an alias "Opus" and puts "Opus 5.5" at the start of its description.
  const family = /^(?:Claude\s+)?(Opus|Sonnet|Fable|Haiku)$/i.exec(label)?.[1];
  if (family) {
    const versioned = new RegExp(`^((?:Claude\\s+)?${family}\\s+\\d+(?:\\.\\d+)*)(?=\\s|$|[（(])`, 'i').exec(description)?.[1];
    if (versioned) return versioned;
  }
  return label || option.value;
}
