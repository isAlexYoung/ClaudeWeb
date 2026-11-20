import { fireEvent, render } from '@testing-library/react';
import { expect, test } from 'vitest';

import '@/modules/i18n';
import { ResponseProcess } from '@/modules/chat/transcript/ResponseProcess';

test('a manual collapse survives new streaming content and the interrupted/completed state', () => {
  const view = render(<ResponseProcess running><p>Initial progress</p></ResponseProcess>);
  const details = view.container.querySelector('details')!;
  expect(details.open).toBe(true);
  details.open = false; fireEvent(details, new Event('toggle'));
  view.rerender(<ResponseProcess running><p>More progress</p></ResponseProcess>);
  expect(details.open).toBe(false);
  view.rerender(<ResponseProcess running={false}><p>Partial progress retained</p></ResponseProcess>);
  expect(details.open).toBe(false); expect(details.textContent).toContain('Partial progress retained');
});

test('historical processes start closed and a navigation request can open them without losing that state', () => {
  const view = render(<ResponseProcess running={false}><p>Old progress</p></ResponseProcess>);
  const details = view.container.querySelector('details')!;
  expect(details.open).toBe(false);
  details.open = true; fireEvent(details, new Event('toggle'));
  view.rerender(<ResponseProcess running={false}><p>Old progress after hydration</p></ResponseProcess>);
  expect(details.open).toBe(true);
});
