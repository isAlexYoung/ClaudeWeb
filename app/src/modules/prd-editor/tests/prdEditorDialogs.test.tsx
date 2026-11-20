import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test, vi } from 'vitest';

import GenerateTasksModal from '@/modules/prd-editor/modals/GenerateTasksModal';
import OverwriteConfirmModal from '@/modules/prd-editor/modals/OverwriteConfirmModal';
import PrdEditorFooter from '@/modules/prd-editor/PrdEditorFooter';
import '@/modules/i18n';

test('the generate-tasks dialog shows the same parse-prd prompt as the composer menu', () => {
  const view = render(<GenerateTasksModal isOpen fileName="app.md" onClose={() => {}} />);
  assert.ok(view.getByText(/task-master parse-prd \.taskmaster\/docs\/app\.md/));
  assert.ok(view.getByRole('dialog', { name: 'Generate tasks from this PRD' }));
});

test('the overwrite dialog names the file and confirms through its own button', () => {
  const confirm = vi.fn();
  const view = render(<OverwriteConfirmModal isOpen fileName="app.md" saving={false} onCancel={() => {}} onConfirm={confirm} />);
  assert.ok(view.getByText(/"app\.md" already exists/));
  fireEvent.click(view.getByRole('button', { name: /Overwrite/ }));
  assert.equal(confirm.mock.calls.length, 1);
});

test('the footer counts lines, words and characters through the translated label', () => {
  const view = render(<PrdEditorFooter content={'one two\nthree'} />);
  assert.ok(view.getByText(/2 lines · 3 words · 13 characters/));
});
