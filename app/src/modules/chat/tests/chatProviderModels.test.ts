import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The four per-provider default models used to be four useState slots with four
 * copy-pasted reconciliation effects and a four-branch setter. They are now one
 * Record with one loop. These tests pin the behaviour that has to survive that:
 * each provider keeps its own model, under its own storage key, and choosing a
 * model persists it.
 */

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

// The catalog the server answers with; a test sets it before rendering.
const catalog = vi.hoisted(() => ({ models: null as unknown }));

vi.mock('@/shared/api', () => ({
  api: {
    // The preference store PATCHes through api.user; it is stubbed rather than
    // exercised here, which keeps these tests about the model record.
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () => okJson({ success: true, data: catalog.models ? { models: catalog.models } : null }),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
      createModel: () => okJson({ success: true, data: null }),
      updateModel: () => okJson({ success: true, data: null }),
      removeModel: () => okJson({ success: true, data: null }),
    },
  },
}));

const renderProviderState = async () => {
  const { useChatProviderState } = await import(
    '@/modules/chat/hooks/useChatProviderState'
  );
  return renderHook(() =>
    useChatProviderState({ selectedSession: null, selectedProject: null }),
  );
};

beforeEach(() => {
  catalog.models = null;
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

afterEach(() => {
  vi.resetModules();
});

test('the provider model is read from its own storage key', async () => {
  localStorage.setItem('claude-model', 'claude-stored');

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.providerModels.claude, 'claude-stored');
  });
});

test('choosing a model persists it under the provider key', async () => {
  const { result } = await renderProviderState();
  await waitFor(() => {
    assert.ok(result.current.providerModels.claude);
  });

  act(() => {
    result.current.setStoredProviderModel('claude', 'claude-chosen');
  });

  assert.equal(result.current.providerModels.claude, 'claude-chosen');
  assert.equal(localStorage.getItem('claude-model'), 'claude-chosen');
});

test('setting the same model twice keeps the record identity stable', async () => {
  const { result } = await renderProviderState();
  await waitFor(() => {
    assert.ok(result.current.providerModels.claude);
  });

  act(() => {
    result.current.setStoredProviderModel('claude', 'pinned');
  });
  const afterFirst = result.current.providerModels;

  act(() => {
    result.current.setStoredProviderModel('claude', 'pinned');
  });

  assert.equal(
    result.current.providerModels,
    afterFirst,
    'a no-op write must not allocate a new record and wake consumers',
  );
});

test('the active provider’s model is what currentProviderModel reports', async () => {
  // The provider selection is a stored preference; the per-provider model is
  // still a plain localStorage key.
  writeUserPreference('selectedProvider', 'claude');
  localStorage.setItem('claude-model', 'claude-active');

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.provider, 'claude');
  });
  assert.equal(result.current.currentProviderModel, 'claude-active');
});

test('a saved model the plan does not include gives way to the catalog default', async () => {
  localStorage.setItem('claude-model', 'fable');
  catalog.models = {
    DEFAULT: 'default',
    OPTIONS: [
      { value: 'default', label: 'Default (recommended)' },
      { value: 'opus', label: 'Opus 5.5' },
      { value: 'fable', label: 'Fable 5.2', unavailable: 'subscription' },
    ],
  };

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.currentProviderModelOptions.length, 3);
  });
  // The stored choice is kept (the plan may change back), but neither shown nor sent.
  assert.equal(result.current.providerModels.claude, 'fable');
  assert.equal(result.current.currentProviderModel, 'default');
});

test('a saved model the plan includes is used as it is', async () => {
  localStorage.setItem('claude-model', 'opus');
  catalog.models = {
    DEFAULT: 'default',
    OPTIONS: [
      { value: 'default', label: 'Default (recommended)' },
      { value: 'opus', label: 'Opus 5.5' },
      { value: 'fable', label: 'Fable 5.2', unavailable: 'subscription' },
    ],
  };

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.currentProviderModelOptions.length, 3);
  });
  assert.equal(result.current.currentProviderModel, 'opus');
});
