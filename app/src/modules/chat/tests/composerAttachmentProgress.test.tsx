import { fireEvent, render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import ComposerAttachment from '@/modules/chat/composer/ComposerAttachment';
import '@/modules/i18n';

test('an uploading file is grey, shows its percentage and has a visible cancel button', () => {
  const cancel = vi.fn();
  const file = new File(['content'], 'large.pdf', { type: 'application/pdf' });
  const view = render(<ComposerAttachment file={file} onRemove={cancel} uploadPercent={80} uploading />);
  expect(view.getByText('80%')).toBeTruthy();
  expect(view.container.querySelector('[aria-busy="true"] .grayscale') !== null).toBe(true);
  const button = view.getByRole('button');
  expect(button.className.includes('sm:opacity-0')).toBe(false);
  fireEvent.click(button);
  expect(cancel).toHaveBeenCalledTimes(1);
});
