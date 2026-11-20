import type { TextQuote } from '@/shared/types';

/** Used by SelectionTools to capture only one visible transcript message at a time. */
export function captureTextQuote(root: HTMLElement, selection: Selection): { source: TextQuote; rect: DOMRect } | null {
  if (selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const start = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement) as Element | null;
  const end = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement) as Element | null;
  const row = start?.closest<HTMLElement>('[data-selection-message]');
  if (!row || !root.contains(row) || end?.closest('[data-selection-message]') !== row || start?.closest('button, textarea, input')) return null;
  const text = range.toString();
  if (!text.trim() || text.length > 100_000) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(row); prefix.setEnd(range.startContainer, range.startOffset);
  const rects = range.getClientRects();
  const rect = rects[rects.length - 1] || range.getBoundingClientRect();
  return { source: {
    id: crypto.randomUUID(), messageKey: row.dataset.sourceMessageKey || '', text,
    role: row.dataset.sourceRole || 'assistant',
    kind: row.dataset.sourceKind === 'thinking' || start?.closest('[data-quote-kind="thinking"]') ? 'thinking' : 'text',
    startOffset: prefix.toString().length, timestamp: row.dataset.messageTimestamp || '',
  }, rect };
}

/** Used by SelectionTools to re-anchor a saved excerpt without mutating React-managed markdown nodes. */
export function locateQuoteRange(root: HTMLElement, source: TextQuote): Range | null {
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-selection-message]'));
  // Inline reasoning and the visible answer share a source identity after the process is folded separately.
  let row = rows.find(el => el.dataset.sourceMessageKey === source.messageKey && el.dataset.sourceKind === source.kind)
    || rows.find(el => el.dataset.sourceMessageKey === source.messageKey);
  if (!row) {
    const candidates = rows.filter(el => el.dataset.sourceRole === source.role && el.textContent?.includes(source.text));
    row = candidates.find(el => source.timestamp && new Date(el.dataset.messageTimestamp || '').getTime() === new Date(source.timestamp).getTime());
    if (!row && candidates.length === 1) row = candidates[0];
  }
  if (!row) return null;
  const text = row.textContent || '';
  let start = source.startOffset;
  if (text.slice(start, start + source.text.length) !== source.text) {
    start = text.indexOf(source.text);
    // A changed paragraph with duplicate text is ambiguous; never underline the wrong occurrence.
    if (start < 0 || text.indexOf(source.text, start + 1) >= 0) return null;
  }
  const end = start + source.text.length;
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const range = document.createRange(); let offset = 0; let started = false;
  while (walker.nextNode()) {
    const node = walker.currentNode; const length = node.textContent?.length || 0;
    if (!started && start < offset + length) { range.setStart(node, start - offset); started = true; }
    if (started && end <= offset + length) { range.setEnd(node, end - offset); return range; }
    offset += length;
  }
  return null;
}
