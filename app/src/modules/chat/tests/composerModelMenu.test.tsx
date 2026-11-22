import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import type { ProviderModelOption } from '@/shared/types';
import '@/modules/i18n';

// What Claude Code reports when it points at a custom endpoint that serves one model for every alias.
const customEndpointModels: ProviderModelOption[] = [
  { value: 'default', label: 'Default (recommended)', description: 'Use the default model' },
  { value: 'opus', label: 'deepseek-v4-pro', description: 'Custom Opus model (1M context)', supportsFastMode: true },
  { value: 'sonnet', label: 'deepseek-v4-pro', description: 'Custom Sonnet model (1M context)' },
  { value: 'haiku', label: 'deepseek-v4-pro', description: 'Custom Haiku model' },
];

function openMenu(model: string, fastMode = false) {
  const view = render(<ComposerModelMenu effort="default" effortOptions={[]} onSelectEffort={() => {}} model={model}
    modelOptions={customEndpointModels} onSelectModel={() => {}} modelsLoading={false} fastMode={fastMode} onToggleFastMode={() => {}} />);
  return view;
}

test('an unresolved inherited model asks for a selection without claiming an actual model', () => {
  const view = openMenu('default');
  fireEvent.click(view.getByRole('button'));
  const rows = view.getAllByRole('menuitemradio');
  assert.match(rows[0].textContent || '', /Select Model/);
  assert.equal(rows[0].getAttribute('aria-checked'), 'true');
});

test('missing CLI login disables model and effort together, closes an open menu and restores after login', () => {
  const props = { effort: 'high', effortOptions: [{ value: 'high' }], onSelectEffort: () => {},
    model: 'opus', modelOptions: customEndpointModels.map(option => ({ ...option, effort: { default: 'high', values: [{ value: 'high' }] } })),
    onSelectModel: () => {}, modelsLoading: false };
  const view = render(<ComposerModelMenu {...props} disabled />);
  const trigger = view.getByRole('button') as HTMLButtonElement;
  assert.equal(trigger.disabled, true);
  assert.match(trigger.textContent || '', /High/);
  fireEvent.click(trigger);
  assert.equal(view.queryByRole('menu'), null);
  view.rerender(<ComposerModelMenu {...props} disabled={false} />);
  assert.equal(trigger.disabled, false);
  fireEvent.click(trigger);
  assert.ok(view.getByRole('menu'));
  view.rerender(<ComposerModelMenu {...props} disabled />);
  assert.equal(view.queryByRole('menu'), null);
  view.rerender(<ComposerModelMenu {...props} disabled={false} />);
  assert.equal(view.queryByRole('menu'), null, 'logging in must not reopen a previously dismissed menu');
});

test('Chat and Code shared model control names the resolved model and sends the displayed effort', () => {
  const levels = [{ value: 'medium' }, { value: 'high' }];
  const models: ProviderModelOption[] = [
    { value: 'default', label: 'Default (recommended)', description: 'Sonnet 5.5 · Efficient for routine tasks', effort: { default: 'medium', values: levels } },
    { value: 'sonnet', label: 'Sonnet 5.5', effort: { default: 'medium', values: levels } },
  ];
  let chosen = '';
  const view = render(<ComposerModelMenu effort="default" effortOptions={levels} onSelectEffort={value => { chosen = value; }}
    model="default" modelOptions={models} onSelectModel={() => {}} modelsLoading={false} />);
  const trigger = view.getByRole('button');
  assert.match(trigger.textContent || '', /Sonnet 5.5/);
  assert.match(trigger.textContent || '', /Medium/);
  assert.doesNotMatch(trigger.textContent || '', /Default/);
  fireEvent.click(trigger);
  fireEvent.click(view.getByRole('menuitem', { name: /Effort/ }));
  const row = view.getAllByRole('menuitemradio').find(item => item.textContent === 'Medium');
  assert.equal(row?.getAttribute('aria-checked'), 'true');
  fireEvent.click(view.getByRole('menuitemradio', { name: 'High' }));
  assert.equal(chosen, 'high');
});

test('custom endpoint trigger displays the actual model name even when family aliases share it', () => {
  assert.match(openMenu('opus').getByRole('button').textContent || '', /deepseek-v4-pro/);
});

test('aliases sharing a model name show the actual name, with routing family in the description', () => {
  const view = openMenu('default');
  fireEvent.click(view.getByRole('button'));
  const labels = view.getAllByRole('menuitemradio').map(row => row.textContent || '');
  for (const family of ['Opus', 'Sonnet', 'Haiku']) {
    assert.ok(labels.some(text => text.startsWith('deepseek-v4-pro') && text.includes(family)));
  }
});

test('the actual SDK instruction from the screenshot is reduced to Opus 5.5 everywhere', () => {
  const models: ProviderModelOption[] = [
    { value: 'default', label: 'Default (recommended)', description: 'Use the default model (currently Opus 5.5) · $4/$20 per Mtok' },
    { value: 'opus', label: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok' },
    { value: 'sonnet', label: 'Sonnet', description: 'Sonnet 5.5 · Efficient for routine tasks' },
    { value: 'fable', label: 'Fable', description: 'Fable 5.2 · Most capable for your hardest tasks' },
  ];
  const props = { effort: 'default', effortOptions: [], onSelectEffort: () => {}, modelOptions: models, onSelectModel: () => {}, modelsLoading: false };
  const view = render(<ComposerModelMenu {...props} model="default" />);
  assert.equal(view.getByRole('button').querySelector('span')?.textContent, 'Opus 5.5');
  fireEvent.click(view.getByRole('button'));
  const rows = view.getAllByRole('menuitemradio');
  assert.equal(rows.filter(row => row.querySelector('.block.truncate')?.textContent === 'Opus 5.5').length, 1);
  assert.ok(rows.some(row => row.querySelector('.block.truncate')?.textContent === 'Sonnet 5.5'));
  assert.ok(rows.some(row => row.querySelector('.block.truncate')?.textContent === 'Fable 5.2'));
  assert.doesNotMatch(document.body.textContent || '', /default|currently|默认/i);
  // Explicitly selecting the family alias must use the same versioned display name.
  view.rerender(<ComposerModelMenu {...props} model="opus" />);
  assert.equal(view.getByRole('button').querySelector('span')?.textContent, 'Opus 5.5');
  assert.doesNotMatch(document.body.textContent || '', /default|currently|默认/i);
});

test('a default instruction in the display-name field is parsed without assuming a particular version', () => {
  for (const name of ['Opus 5.5', 'Sonnet 5.6', 'my-gateway-model-v2']) {
    const view = render(<ComposerModelMenu effort="default" effortOptions={[]} onSelectEffort={() => {}} model="default"
      modelOptions={[{ value: 'default', label: `Use the default model (currently ${name})`, description: `Use the default model (currently ${name}) · $1/$2 per Mtok` }]}
      onSelectModel={() => {}} modelsLoading={false} />);
    assert.equal(view.getByRole('button').querySelector('span')?.textContent, name);
    fireEvent.click(view.getByRole('button'));
    assert.doesNotMatch(document.body.textContent || '', /default|currently|默认/i);
    view.unmount();
  }
});

test('the model button shows Fast while fast mode is on for a model that supports it', () => {
  const buttonText = (model: string, fastMode: boolean) => openMenu(model, fastMode).container.querySelector('button')?.textContent || '';
  assert.match(buttonText('opus', true), /Fast/);
  assert.doesNotMatch(buttonText('sonnet', true), /Fast/);
  assert.doesNotMatch(buttonText('opus', false), /Fast/);
});

test('switching from other models to effort never leaves three panels occupying the layout', () => {
  const view = render(<ComposerModelMenu effort="high" effortOptions={[{ value: 'high' }, { value: 'low' }]} onSelectEffort={() => {}}
    model="opus" modelOptions={[...customEndpointModels, { value: 'old', label: 'Old model' }]} onSelectModel={() => {}} modelsLoading={false} />);
  fireEvent.click(view.getByRole('button'));
  const menuItems = () => view.getAllByRole('menuitem');
  fireEvent.click(menuItems().at(-1)!);
  assert.equal(document.querySelectorAll('.workspace-model-panel').length, 2);
  fireEvent.click(menuItems()[0]);
  assert.equal(document.querySelectorAll('.workspace-model-panel').length, 2);
  assert.equal(document.querySelectorAll('.workspace-effort-panel').length, 1);
});
