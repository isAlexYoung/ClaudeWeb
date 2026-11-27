import assert from 'node:assert/strict';

import { test } from 'vitest';

import { connectorLabel } from '@/modules/project-workspace/utils/connectorLabel';

test('CMCP connectors are named after the computer and the route that reaches it', () => {
  const pc = 'cmcp-pc-cdb17040cecafd36';
  assert.equal(connectorLabel({ name: pc, status: 'connected', platform: 'windows', routes: ['web'] }), 'windows-web');
  assert.equal(connectorLabel({ name: pc, status: 'connected', platform: 'windows', routes: ['ssh'] }), 'windows-ssh');
  assert.equal(connectorLabel({ name: pc, status: 'connected', platform: 'mac', routes: ['web', 'ssh'] }), 'mac-web + ssh');
  assert.equal(connectorLabel({ name: 'linux-pc-files', status: 'disconnected', platform: 'linux', routes: ['web'] }), 'linux-web');
  // A standalone SSH connector does not say which computer it reaches.
  assert.equal(connectorLabel({ name: 'cmcp-ssh-cdb17040', status: 'connected', routes: ['ssh'] }), 'ssh');
});

test('other connectors, and values the page does not know, keep the configured name', () => {
  assert.equal(connectorLabel({ name: 'github', status: 'idle' }), 'github');
  assert.equal(connectorLabel({ name: 'x', status: 'connected', routes: [] }), 'x');
  const unknown = { name: 'x', status: 'connected', platform: 'amiga', routes: ['carrier-pigeon'] } as unknown as Parameters<typeof connectorLabel>[0];
  assert.equal(connectorLabel(unknown), 'x');
  const odd = { name: 'x', status: 'connected', platform: 'amiga', routes: ['ssh'] } as unknown as Parameters<typeof connectorLabel>[0];
  assert.equal(connectorLabel(odd), 'ssh');
});
