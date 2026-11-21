// Multi-device login check against an installed ClaudeWeb, as root on the server:
//   node test-devices.mjs <password>
// Prints PASS/FAIL per step; never prints the password or tokens.
import { createRequire } from 'node:module';

const require = createRequire('/opt/claudeweb/current/app/package.json');
const WebSocket = require('ws');
const password = process.argv[2];
const base = 'http://127.0.0.1:3001';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };
let ip = 10;

async function login(body = {}, agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0') {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    // Each "device" comes from its own address, as through Cloudflare.
    headers: { 'content-type': 'application/json', 'user-agent': agent, 'cf-connecting-ip': `198.51.100.${ip++}` },
    body: JSON.stringify({ password, ...body }),
  });
  return { status: response.status, body: await response.json() };
}
const authed = (token, path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
const alive = async (token) => (await authed(token, '/api/auth/user')).status === 200;

// Start from one device: earlier runs may have left logins behind.
const a = await login({ mode: 'takeover' });
check('the first device signs in', a.status === 200 && typeof a.body.token === 'string', String(a.status));
const askB = await login({}, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1');
check('a second device is asked to join or take over', askB.status === 409 && askB.body.error?.code === 'AUTH_CHOICE_REQUIRED', JSON.stringify(askB.body.error?.code));
check('the question lists the signed-in device as main', askB.body.error?.details?.logins?.length === 1 && askB.body.error.details.logins[0].main === true);
const b = await login({ mode: 'join' }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1');
check('joining signs the second device in', b.status === 200);
check('the first device stays signed in', await alive(a.body.token));

const list = await (await authed(b.body.token, '/api/auth/devices')).json();
check('the device list shows both, the first as main, the second as this device',
  list.logins?.length === 2 && list.logins[0].main && !list.logins[0].current && list.logins[1].current,
  JSON.stringify(list.logins?.map((login) => [login.device, login.main, login.current])));
check('the list names devices by type', list.logins?.[1]?.device === 'iPhone · Safari', list.logins?.[1]?.device);
check('the list shows no session ids or tokens', !JSON.stringify(list).includes(a.body.token.slice(-20)));

const mainOnly = await authed(b.body.token, '/api/claudeweb-update/update', { method: 'POST', body: JSON.stringify({ version: '9.9.9' }) });
check('only the main device may start an update', mainOnly.status === 403 && (await mainOnly.json()).error?.code === 'NOT_MAIN_DEVICE');

// Signing the first device out from the second closes its open connections too.
const socket = new WebSocket(`ws://127.0.0.1:3001/ws?token=${encodeURIComponent(a.body.token)}`);
await new Promise((resolve) => { socket.on('open', resolve); socket.on('error', resolve); });
const closed = new Promise((resolve) => socket.on('close', (code) => resolve(code)));
const kick = await authed(b.body.token, '/api/auth/devices', { method: 'POST', body: JSON.stringify({ op: 'end', ref: list.logins[0].ref }) });
check('the second device signs the first one out', kick.status === 200);
check('the first device\'s token stops working', !(await alive(a.body.token)));
const code = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve('still open'), 25_000))]);
check('the first device\'s open connection is closed', code === 4401, String(code));
check('the second device is now main', (await (await authed(b.body.token, '/api/auth/devices')).json()).logins?.[0]?.current === true);

const c = await login({ mode: 'join' });
const d = await login({ mode: 'join' });
check('two more devices join (three in total)', c.status === 200 && d.status === 200);
const e = await login({ mode: 'join' });
check('a fourth device must choose one to sign out', e.status === 409 && e.body.error?.code === 'AUTH_DEVICE_LIMIT');
const replaced = e.body.error?.details?.logins?.find((login) => login.device === 'iPhone · Safari');
const e2 = await login({ mode: 'join', replace: replaced?.ref });
check('naming one signs it out and lets the new device in', e2.status === 200 && !(await alive(b.body.token)) && await alive(c.body.token));

const f = await login({ mode: 'takeover' });
check('take over signs every other device out', f.status === 200 && !(await alive(c.body.token)) && !(await alive(d.body.token)) && !(await alive(e2.body.token)));
check('after take over only this device is listed', (await (await authed(f.body.token, '/api/auth/devices')).json()).logins?.length === 1);

const logout = await authed(f.body.token, '/api/auth/logout', { method: 'POST' });
check('logout ends this device', logout.status === 200 && !(await alive(f.body.token)));

console.log(results.every(Boolean) ? 'DEVICES ALL PASS' : 'DEVICES SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
