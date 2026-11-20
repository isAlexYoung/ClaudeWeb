import type { ChatMessage, DiffCalculator, FileChange, FileChangeHunk, TurnChanges } from '@/shared/types';
import { getToolConfig } from '@/modules/chat/tools';
import { parseToolPayload } from '@/modules/chat/utils/messageTransforms';

type Hunk = Omit<FileChangeHunk, 'edit'>;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Claude Code's own record of the edit (`structuredPatch`), with the file's line numbers; null when absent. */
function readStructuredPatch(toolUseResult: unknown): Hunk[] | null {
  const patch = isRecord(toolUseResult) ? toolUseResult.structuredPatch : undefined;
  if (!Array.isArray(patch) || patch.length === 0) return null;
  const hunks: Hunk[] = [];
  for (const entry of patch) {
    if (!isRecord(entry) || !Array.isArray(entry.lines)) return null;
    hunks.push({
      oldStart: typeof entry.oldStart === 'number' ? entry.oldStart : 0,
      newStart: typeof entry.newStart === 'number' ? entry.newStart : 0,
      lines: entry.lines.filter((line): line is string => typeof line === 'string'),
    });
  }
  return hunks;
}

const countLines = (hunks: Hunk[]) => {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  }
  return { added, removed };
};

/**
 * The file change one successful edit tool call made, or null when the row is
 * not a file edit (or it failed). Uses the same tool configuration as the
 * transcript's own diff cards, so the counts agree with their `+12 -3` badges
 * when Claude Code recorded no patch.
 */
function readEdit(message: ChatMessage, createDiff: DiffCalculator): { path: string; created: boolean; hunks: Hunk[] } | null {
  if (!message.isToolUse || !message.toolName || !message.toolResult || message.toolResult.isError) return null;
  const config = getToolConfig(message.toolName).input;
  if (config.contentType !== 'diff' || !config.getContentProps) return null;
  const props = config.getContentProps(parseToolPayload(message.toolInput) ?? {});
  const path = typeof props?.filePath === 'string' ? props.filePath : '';
  if (!path) return null;
  const result = message.toolResult.toolUseResult;
  const created = isRecord(result) && result.type === 'create';
  const recorded = readStructuredPatch(result);
  if (recorded) return { path, created, hunks: recorded };
  if (typeof props.oldContent !== 'string' || typeof props.newContent !== 'string') return null;
  const lines = createDiff(props.oldContent, props.newContent).map((line) => `${line.type === 'added' ? '+' : '-'}${line.content}`);
  if (lines.length === 0) return null;
  // A new file's lines are its own line numbers; an edited snippet's are not the file's.
  return { path, created, hunks: [{ oldStart: 0, newStart: props.oldContent === '' ? 1 : 0, lines }] };
}

/**
 * Used by ChatMessagesPane to place the change summary card: for each turn
 * (a user message and everything up to the next one) that edited files, the
 * turn's last message maps to what it changed. The last turn is left out
 * while it is still running.
 */
export function collectTurnChanges(messages: ChatMessage[], createDiff: DiffCalculator, lastTurnRunning: boolean): Map<ChatMessage, TurnChanges> {
  const byLastMessage = new Map<ChatMessage, TurnChanges>();
  let files = new Map<string, FileChange>();
  let editCounts = new Map<string, number>();
  let turnId = 'start';
  let lastMessage: ChatMessage | null = null;

  const closeTurn = () => {
    if (lastMessage && files.size > 0) {
      const list = [...files.values()];
      byLastMessage.set(lastMessage, {
        id: turnId,
        files: list,
        added: list.reduce((sum, file) => sum + file.added, 0),
        removed: list.reduce((sum, file) => sum + file.removed, 0),
      });
    }
    files = new Map();
    editCounts = new Map();
  };

  messages.forEach((message, index) => {
    if (message.type === 'user') {
      closeTurn();
      turnId = String(message.transcriptAnchorId || `turn-${index}`);
    }
    lastMessage = message;
    const edit = readEdit(message, createDiff);
    if (!edit) return;
    const editNumber = editCounts.get(edit.path) ?? 0;
    editCounts.set(edit.path, editNumber + 1);
    const counts = countLines(edit.hunks);
    const file = files.get(edit.path) ?? { path: edit.path, added: 0, removed: 0, created: edit.created, hunks: [] };
    file.added += counts.added;
    file.removed += counts.removed;
    file.hunks.push(...edit.hunks.map((hunk) => ({ ...hunk, edit: editNumber })));
    files.set(edit.path, file);
  });
  if (!lastTurnRunning) closeTurn();
  return byLastMessage;
}

/**
 * A changed file's path as the card and the Changes panel show it: the folder
 * part (relative to the project when it is inside it) and the file name.
 */
export function splitChangePath(path: string, projectRoot?: string): { directory: string; name: string } {
  const root = (projectRoot || '').replace(/\/+$/, '');
  const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const slash = relative.lastIndexOf('/');
  return slash < 0 ? { directory: '', name: relative } : { directory: relative.slice(0, slash + 1), name: relative.slice(slash + 1) };
}

/** One row of a hunk as the Changes panel draws it, with the file's line numbers when they are known. */
export type HunkRow =
  | { kind: 'line'; sign: ' ' | '-' | '+'; text: string; oldNumber: number | null; newNumber: number | null }
  | { kind: 'gap'; count: number }
  | { kind: 'edit-break' };

/**
 * Lays a file's hunks out for display: unchanged stretches between hunks of
 * the same edit collapse into "N unmodified lines", and the hunks of a later
 * edit start after a divider, since their line numbers count from the file as
 * the earlier edit left it.
 */
export function layoutFileHunks(hunks: FileChangeHunk[]): HunkRow[] {
  const rows: HunkRow[] = [];
  let previous: { edit: number; oldEnd: number } | null = null;
  for (const hunk of hunks) {
    const numbered = hunk.oldStart > 0 || hunk.newStart > 0;
    if (previous && previous.edit !== hunk.edit) rows.push({ kind: 'edit-break' });
    const gapStart = previous && previous.edit === hunk.edit ? previous.oldEnd : 1;
    if (numbered && hunk.oldStart > gapStart) rows.push({ kind: 'gap', count: hunk.oldStart - gapStart });
    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;
    for (const line of hunk.lines) {
      const sign = line[0] === '-' || line[0] === '+' ? line[0] : ' ';
      const text = line[0] === '-' || line[0] === '+' || line[0] === ' ' ? line.slice(1) : line;
      rows.push({
        kind: 'line',
        sign,
        text,
        oldNumber: numbered && hunk.oldStart > 0 && sign !== '+' ? oldNumber : null,
        newNumber: numbered && sign !== '-' ? newNumber : null,
      });
      if (sign !== '+') oldNumber += 1;
      if (sign !== '-') newNumber += 1;
    }
    previous = { edit: hunk.edit, oldEnd: oldNumber };
  }
  return rows;
}
