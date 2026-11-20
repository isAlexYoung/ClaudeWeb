import { expect, test, vi } from 'vitest';

import { highlightSearchKeywords } from '@/modules/chat/utils/highlightSearchKeywords';

test('literal keyword ranges highlight case-insensitive and split markdown text without modifying the DOM', () => {
  const registry = new Map();
  const HighlightType = vi.fn(function (...ranges: Range[]) { return { ranges }; });
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', HighlightType);
  const root = document.createElement('div'); root.innerHTML = '<p>Hello <strong>he</strong>llo [hello] <button>hello</button></p>';
  const original = root.innerHTML;
  try {
    const clear = highlightSearchKeywords(root, 'hello');
    expect(registry.get('claudeweb-search-keyword').ranges.map((range: Range) => range.toString())).toEqual(['Hello', 'hello', 'hello']);
    expect(root.innerHTML).toBe(original);
    clear(); expect(registry.size).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});

test('keywords become highlighted when lazy markdown mounts after navigation', async () => {
  const registry = new Map();
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', function (...ranges: Range[]) { return { ranges }; });
  const root = document.createElement('div');
  const clear = highlightSearchKeywords(root, 'hello');
  try {
    expect(registry.get('claudeweb-search-keyword').ranges).toHaveLength(0);
    root.innerHTML = '<p>Hello after mount</p>';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(registry.get('claudeweb-search-keyword').ranges[0].toString()).toBe('Hello');
  } finally { clear(); vi.unstubAllGlobals(); }
});
