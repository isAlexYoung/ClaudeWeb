import type { ChatMessage, MessageSearchTarget } from '@/shared/types';

/**
 * Locates the message a sidebar search result points at, against the loaded
 * transcript rather than the rendered DOM.
 *
 * The jump used to render the entire transcript and then scan `.chat-message`
 * textContent for the snippet, retrying fifteen times before giving up
 * silently. Resolving the index from the data first means the caller can size
 * the render window so the target is guaranteed to be on screen, and a miss is
 * knowable instead of being papered over by the nearest-timestamp fallback.
 */

/** Shorter fragments match too many messages to identify one. */
const MIN_SNIPPET_LENGTH = 10;

/** The sidebar sends an elided fragment; only the leading part is reliable. */
const MAX_SNIPPET_LENGTH = 80;

/** Every field of a message that ends up as rendered text. */
function getSearchableText(message: ChatMessage): string {
  const parts = [message.displayText, message.content];

  if (typeof message.toolInput === 'string') {
    parts.push(message.toolInput);
  }
  const toolResultContent = message.toolResult?.content;
  if (typeof toolResultContent === 'string') {
    parts.push(toolResultContent);
  }

  return parts.filter(Boolean).join('\n').toLowerCase();
}

function normalizeSearchSnippet(snippet: string): string {
  return snippet
    .replace(/^(?:\.{3}|…)/, '')
    .replace(/(?:\.{3}|…)$/, '')
    .trim()
    .slice(0, MAX_SNIPPET_LENGTH)
    .toLowerCase()
    .trim();
}

/**
 * Returns the index of the best match, or -1 when the target is not in the
 * loaded transcript. The snippet is authoritative; the timestamp only breaks a
 * tie when no snippet matched, mirroring what the previous DOM scan did.
 */
export function findSearchTargetIndex(
  messages: ChatMessage[],
  target: MessageSearchTarget,
): number {
  // Claude transcript UUIDs can be split into several normalized content rows.
  const byIdentity = target.messageUuid ? messages.map((message, index) => ({ message, index })).filter(({ message }) =>
    [message.id, message.messageId].some(id => String(id) === target.messageUuid || String(id).startsWith(`${target.messageUuid}_`))) : [];
  if (byIdentity.length) {
    const phrase = target.snippet ? normalizeSearchSnippet(target.snippet) : '';
    const exact = phrase && byIdentity.find(({ message }) => getSearchableText(message).includes(phrase));
    return (exact || byIdentity.find(({ message }) => !target.role || message.type === target.role) || byIdentity[0]).index;
  }
  if (target.snippet) {
    const phrase = normalizeSearchSnippet(target.snippet);
    const matches = messages.map((message, index) => ({ message, index })).filter(({ message }) =>
      phrase.length >= MIN_SNIPPET_LENGTH ? getSearchableText(message).includes(phrase)
        : phrase.length > 0 && getSearchableText(message).split('\n').some(part => part.trim() === phrase));
    if (matches.length) {
      const sameTime = target.timestamp && matches.find(({ message }) => new Date(message.timestamp).getTime() === new Date(target.timestamp!).getTime());
      return (sameTime || matches.find(({ message }) => target.role && message.type === target.role) || matches[0]).index;
    }
  }

  if (target.timestamp) {
    const targetTime = new Date(target.timestamp).getTime();
    if (Number.isFinite(targetTime)) {
      let closestIndex = -1;
      let closestDistance = Infinity;

      for (const [index, message] of messages.entries()) {
        const messageTime = new Date(message.timestamp).getTime();
        if (!Number.isFinite(messageTime)) {
          continue;
        }

        const distance = Math.abs(messageTime - targetTime);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      }

      return closestIndex;
    }
  }

  return -1;
}

/**
 * How many trailing messages must be rendered for `targetIndex` to be on screen.
 *
 * `visibleMessages` is a tail slice, so covering an old hit means rendering
 * everything after it. Exported for the caller and pinned by tests because an
 * off-by-one here scrolls to the wrong row or to nothing at all.
 */
export function resolveSearchWindowSize(
  messageCount: number,
  targetIndex: number,
  trailingContext: number,
): number {
  return messageCount - targetIndex + trailingContext;
}
