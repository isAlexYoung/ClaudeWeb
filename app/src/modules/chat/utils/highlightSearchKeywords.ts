/** Used by useChatSessionState to highlight literal search matches without rewriting React's markdown DOM. */
export function highlightSearchKeywords(root: HTMLElement, query: string): () => void {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightType = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightType || !query.trim()) return () => {};
  const name = 'claudeweb-search-keyword';
  let current: unknown;
  let frame = 0;
  const update = () => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Node; start: number; end: number }> = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('button, script, style, [aria-hidden="true"]')) continue;
      const start = text.length; text += node.textContent || '';
      nodes.push({ node, start, end: text.length });
    }
    const needle = query.trim().toLocaleLowerCase();
    const haystack = text.toLocaleLowerCase();
    const ranges: Range[] = [];
    for (let start = haystack.indexOf(needle); start >= 0; start = haystack.indexOf(needle, start + needle.length)) {
      const end = start + needle.length;
      const first = nodes.find(node => node.start <= start && start < node.end);
      const last = nodes.find(node => node.start < end && end <= node.end);
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
      ranges.push(range);
    }
    const highlight = new HighlightType(...ranges);
    current = highlight;
    registry.set(name, highlight);
  };
  update();
  // Search first reveals the lazy row; its actual markdown may mount on the next frame.
  const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => { observer.disconnect(); cancelAnimationFrame(frame); if (registry.get(name) === current) registry.delete(name); };
}
