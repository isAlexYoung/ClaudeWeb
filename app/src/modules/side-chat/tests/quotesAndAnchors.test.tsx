import assert from 'node:assert/strict';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { beforeAll, test } from 'vitest';
import { i18n } from '@/modules/i18n';
import { QuoteDrafts } from '@/modules/side-chat/QuoteDrafts';
import { useTextQuotes } from '@/modules/side-chat/hooks/useTextQuotes';
import { captureTextQuote, locateQuoteRange } from '@/modules/side-chat/utils/selectionAnchor';
import { formatQuotedQuestion } from '@/shared/utils';
import type { TextQuote } from '@/shared/types';

beforeAll(async () => { await i18n.changeLanguage('zh-CN'); });
const source: TextQuote = { id: 'q1', text: 'selected thought', role: 'assistant', kind: 'thinking', messageKey: 'message-assistant-1', startOffset: 5, timestamp: '2026-11-18T01:00:00Z' };

test('a folded reasoning projection and final answer sharing an identity keep distinct quotation anchors', () => {
  const root = document.createElement('div');
  root.innerHTML = '<div data-selection-message="true" data-source-message-key="shared" data-source-kind="thinking">reasoning excerpt</div><div data-selection-message="true" data-source-message-key="shared" data-source-kind="text">final answer excerpt</div>';
  assert.equal(locateQuoteRange(root, { ...source, messageKey: 'shared', kind: 'text', text: 'final answer excerpt', startOffset: 0 })?.toString(), 'final answer excerpt');
  assert.equal(locateQuoteRange(root, { ...source, messageKey: 'shared', kind: 'thinking', text: 'reasoning excerpt', startOffset: 0 })?.toString(), 'reasoning excerpt');
});

test('quotes survive a reload, remain per-session and removals renumber their visible labels', () => {
  const hook = renderHook(({ scope }) => useTextQuotes(scope), { initialProps: { scope: 'quote-main-test' } });
  act(() => hook.result.current.addQuote(source));
  act(() => hook.result.current.addQuote({ ...source, id: 'q2', text: 'another text' }));
  hook.rerender({ scope: 'quote-other-test' }); assert.equal(hook.result.current.quotes.length, 0);
  hook.rerender({ scope: 'quote-main-test' }); assert.equal(hook.result.current.quotes.length, 2);
  const view = render(<QuoteDrafts quotes={hook.result.current.quotes} onRemove={ids => hook.result.current.removeQuotes(ids)} />);
  assert.ok(view.getByText('第一条引用')); assert.ok(view.getByText('第二条引用'));
  fireEvent.click(view.getAllByRole('button', { name: '删除引用' })[0]);
  assert.deepEqual(hook.result.current.quotes.map(q => q.id), ['q2']);
  view.rerender(<QuoteDrafts quotes={hook.result.current.quotes} onRemove={() => undefined} />);
  assert.ok(view.getByText('第一条引用')); assert.equal(view.queryByText('第二条引用'), null);
  hook.unmount();
  const reload = renderHook(() => useTextQuotes('quote-main-test'));
  assert.deepEqual(reload.result.current.quotes.map(q => q.id), ['q2']);
});

test('submitted quotations identify the assistant and visible thinking, preserving exact selected text', () => {
  const prompt = formatQuotedQuestion('Is that right?', [source]);
  assert.match(prompt, /"author": "assistant"/); assert.match(prompt, /"source": "thinking"/);
  assert.match(prompt, /selected thought/); assert.ok(prompt.endsWith('Is that right?'));
  assert.equal(formatQuotedQuestion('hello', []), 'hello');
});

test('anchors cross inline formatting, keep the correct repeated occurrence and tolerate an ID hydration', () => {
  const root = document.createElement('div'); root.innerHTML = '<div data-selection-message="true" data-source-message-key="message-assistant-1" data-source-role="assistant" data-message-timestamp="2026-11-18T01:00:00Z">same <b>selected</b> thought, same selected thought</div>';
  document.body.append(root);
  const original = locateQuoteRange(root, source); assert.equal(original?.toString(), source.text);
  const second = { ...source, startOffset: 28 };
  const text = root.textContent!; second.startOffset = text.lastIndexOf(source.text);
  const repeated = locateQuoteRange(root, second); assert.equal(repeated?.startContainer.textContent, ' thought, same selected thought');
  root.firstElementChild!.setAttribute('data-source-message-key', 'message-assistant-persisted');
  assert.equal(locateQuoteRange(root, source)?.toString(), source.text);
  root.firstElementChild!.textContent = 'unrelated changed text'; assert.equal(locateQuoteRange(root, source), null);
  root.remove();
});

test('a selection snapshots visible thinking and rejects selection crossing two messages', () => {
  const root = document.createElement('div'); root.innerHTML = '<div data-selection-message="true" data-source-message-key="k1" data-source-role="assistant" data-source-kind="thinking" data-message-timestamp="today">live thought</div><div data-selection-message="true">other</div>';
  document.body.append(root);
  const range = document.createRange(); range.selectNodeContents(root.firstElementChild!);
  const geometry = new DOMRect(10, 10, 80, 20); range.getClientRects = () => [geometry] as unknown as DOMRectList;
  const selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
  const captured = captureTextQuote(root, selection)!;
  assert.equal(captured.source.text, 'live thought'); assert.equal(captured.source.kind, 'thinking');
  root.firstElementChild!.append(' more tokens'); assert.equal(captured.source.text, 'live thought');
  range.setEnd(root.lastElementChild!.firstChild!, 4); assert.equal(captureTextQuote(root, selection), null);
  root.remove();
});
