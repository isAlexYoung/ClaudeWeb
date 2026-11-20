import { expect, test } from 'vitest';

import { formatQuotedQuestion, parseQuotedQuestion } from '@/shared/utils';
import type { TextQuote } from '@/shared/types';

const quote: TextQuote = { id: 'q1', text: 'quote with ``` and <b>literal</b>\nnext line', role: 'assistant', kind: 'thinking', messageKey: 'source-key', startOffset: 32, timestamp: '2026-11-18T10:00:00Z' };

test('new envelopes round-trip exact quoted text, original position and the unmodified question', () => {
  const result = parseQuotedQuestion(formatQuotedQuestion('my question\n\n```json\n{}\n```', [quote]));
  expect(result.input).toBe('my question\n\n```json\n{}\n```');
  expect(result.quotes[0]).toMatchObject({ ...quote, id: 'sent-quote-0' });
});

test('already-sent legacy envelopes remain readable without requiring a history migration', () => {
  const legacy = formatQuotedQuestion('test', [quote]).replace(/,\n\s+"startOffset": 32,\n\s+"timestamp": "[^"]+"/, '');
  expect(parseQuotedQuestion(legacy)).toMatchObject({ input: 'test', quotes: [{ text: quote.text, messageKey: quote.messageKey, timestamp: '', startOffset: 0 }] });
});

test('plain JSON, pasted examples and damaged envelopes remain visible without losing any user text', () => {
  const encoded = formatQuotedQuestion('test', [quote]);
  for (const content of ['```json\n{"quoted_excerpts": []}\n```', `Here is an example:\n${encoded}`, encoded.replace('"author": "assistant"', '"author": null'), encoded.replace('quoted_excerpts', 'other_field'), encoded.replace('"source-key"', 'null')]) {
    expect(parseQuotedQuestion(content)).toEqual({ input: content, quotes: [] });
  }
});

test('visible tool and error messages keep their source roles when quoted', () => {
  expect(parseQuotedQuestion(formatQuotedQuestion('explain', [{ ...quote, role: 'tool' }, { ...quote, role: 'error' }])).quotes.map(item => item.role)).toEqual(['tool', 'error']);
});
