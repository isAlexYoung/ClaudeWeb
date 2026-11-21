// Browser panel check against an installed ClaudeWeb, as the web page would do it:
//   node test-browser.mjs <token>
// Opens the picture connection, does the RFB handshake noVNC does, asks for a
// frame, then exercises the clipboard, takeover and closing. Prints PASS/FAIL.
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require = createRequire('/opt/claudeweb/current/app/package.json');
const WebSocket = require('ws');
const token = process.argv[2];
const base = 'http://127.0.0.1:3001';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };
const sid = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
const api = (path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

function connect(id, width = 1024, height = 700) {
  const ws = new WebSocket(`ws://127.0.0.1:3001/browser-ws?sid=${id}&w=${width}&h=${height}&token=${encodeURIComponent(token)}`);
  ws.binaryType = 'nodebuffer';
  let buffer = Buffer.alloc(0);
  const waiters = [];
  ws.on('message', (data) => { buffer = Buffer.concat([buffer, data]); waiters.splice(0).forEach((wake) => wake()); });
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  async function read(n, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (buffer.length < n) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} bytes`);
      await new Promise((resolve) => { waiters.push(resolve); setTimeout(resolve, 500); });
      if (ws.readyState > 1 && buffer.length < n) throw new Error(`connection closed while waiting for ${n} bytes`);
    }
    const out = buffer.subarray(0, n); buffer = buffer.subarray(n); return out;
  }
  return { ws, read, closed, available: () => buffer.length };
}

function png() {
  // A 2x2 red image, built by hand so the test needs no image library.
  const crc = (bytes) => { let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const available = await (await api('/api/browser/available')).json();
check('the server reports the browser as available', available.available === true);

const first = sid();
const one = connect(first);
let width = 0, height = 0, name = '';
try {
  const version = (await one.read(12)).toString('latin1');
  check('Xvnc answers with an RFB version', /^RFB 003\.00[38]\n$/.test(version), JSON.stringify(version));
  one.ws.send(Buffer.from('RFB 003.008\n'));
  const count = (await one.read(1))[0];
  const types = [...(await one.read(count))];
  check('the only security type is None (the socket is private)', types.length === 1 && types[0] === 1, types.join(','));
  one.ws.send(Buffer.from([1]));
  check('the security handshake succeeds', (await one.read(4)).readUInt32BE(0) === 0);
  one.ws.send(Buffer.from([0]));
  const init = await one.read(24);
  width = init.readUInt16BE(0); height = init.readUInt16BE(2);
  name = (await one.read(init.readUInt32BE(20))).toString('utf8');
  check('the screen has the size the panel asked for', width === 1024 && height === 700, `${width}x${height}`);
  check('the screen is ClaudeWeb\'s browser display', name === 'ClaudeWeb browser', name);
  // FramebufferUpdateRequest for the whole screen, not incremental.
  const request = Buffer.alloc(10); request[0] = 3; request[1] = 0; request.writeUInt16BE(width, 6); request.writeUInt16BE(height, 8);
  one.ws.send(request);
  const update = await one.read(4);
  check('a frame arrives', update[0] === 0 && update.readUInt16BE(2) > 0, `${update.readUInt16BE(2)} rectangles`);
} catch (error) {
  check('the RFB handshake completes', false, String(error));
}

// Keep it open a while: test-browser.sh looks at the running processes meanwhile.
await new Promise((resolve) => setTimeout(resolve, 12_000));
const status = await (await api(`/api/browser/status?sid=${first}`)).json();
check('status says the browser is open', status.state === 'open', JSON.stringify(status));

const write = await (await api('/api/browser/text-clipboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: first, op: 'write', text: '你好 ClaudeWeb' }) })).json();
check('text can be put on the browser clipboard', write.code === 'OK', JSON.stringify(write));
const read = await (await api('/api/browser/text-clipboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: first, op: 'read' }) })).json();
check('the same Chinese text is read back', read.code === 'OK' && read.text === '你好 ClaudeWeb', JSON.stringify(read));
const image = png();
const imageWrite = await (await api(`/api/browser/image-clipboard?sid=${first}&op=write`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: image })).json();
check('a PNG image can be put on the clipboard', imageWrite.code === 'OK', JSON.stringify(imageWrite));
const imageRead = await api(`/api/browser/image-clipboard?sid=${first}&op=read`, { method: 'POST' });
const imageBytes = Buffer.from(await imageRead.arrayBuffer());
check('the image is read back unchanged', imageRead.headers.get('content-type') === 'image/png' && imageBytes.equals(image), `${imageBytes.length} bytes`);
const bad = await (await api(`/api/browser/image-clipboard?sid=${first}&op=write`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.from('not a png') })).json();
check('something that is not a PNG is refused', bad.code === 'INVALID_IMAGE', JSON.stringify(bad));

// Opened from another tab: that panel takes the same browser over.
const second = sid();
const two = connect(second);
const firstClosed = await Promise.race([one.closed, new Promise((resolve) => setTimeout(() => resolve('still open'), 15_000))]);
check('the first panel is closed when another one takes over', firstClosed === 4001, String(firstClosed));
const moved = await (await api(`/api/browser/status?sid=${first}`)).json();
check('the first panel learns the browser moved', moved.reason === 'browser_moved', JSON.stringify(moved));
let secondOk = false;
try { secondOk = /^RFB/.test((await two.read(12, 20_000)).toString('latin1')); } catch { /* reported below */ }
check('the second panel gets the same running browser at once', secondOk);
two.ws.close(1000);
await two.closed;
let gone = false;
for (let i = 0; i < 40 && !gone; i++) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  gone = (await (await api(`/api/browser/status?sid=${second}`)).json()).state === 'ended';
}
check('closing the panel ends the browser', gone);

console.log(results.every(Boolean) ? 'BROWSER ALL PASS' : 'BROWSER SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
