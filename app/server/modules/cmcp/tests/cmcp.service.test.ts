import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { WebSocket } from 'ws';

import { handleCmcpConnection } from '../cmcp.service.js';

test('CMCP rejects arbitrary connector names and malformed bootstrap before starting a process', () => {
  for (const message of ['{bad', JSON.stringify({ t: 'bootstrap', data: { name: '../../outside' } }), JSON.stringify({ t: 'i', d: 'shell command' })]) {
    const events = new EventEmitter();
    const socket = Object.assign(events, {
      readyState: 1, bufferedAmount: 0, sent: [] as string[], code: 0,
      send(value: string) { this.sent.push(value); },
      close(code: number) { this.code = code; this.readyState = 3; events.emit('close'); },
    });
    handleCmcpConnection(socket as unknown as WebSocket);
    socket.emit('message', Buffer.from(message), false);
    assert.equal(socket.code, 1011);
    assert.equal(JSON.parse(socket.sent[0]).t, 'error');
  }
});
