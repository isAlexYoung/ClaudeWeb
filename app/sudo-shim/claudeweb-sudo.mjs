// Claude's `sudo` in ClaudeWeb (see app/sudo-shim/sudo and server/modules/sudo):
// sends the command line to ClaudeWeb, which asks the user, and prints what the
// command printed. The sudo password never passes through here.
import fs from 'node:fs';
import net from 'node:net';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stderr.write('usage: sudo command [argument ...]\n');
  process.exit(1);
}

// Piped input (`echo x | sudo tee file`) goes to the command; a terminal or
// /dev/null gives it none.
let stdin = Buffer.alloc(0);
try {
  const info = fs.fstatSync(0);
  if (info.isFIFO() || info.isFile()) stdin = fs.readFileSync(0);
} catch { /* no standard input */ }

const reasons = {
  denied: 'the user refused this command in ClaudeWeb',
  timeout: 'nobody allowed this command in ClaudeWeb in time',
  password: 'the sudo password typed in ClaudeWeb was wrong',
  failed: 'ClaudeWeb could not run sudo',
};

const socket = net.connect(process.env.CLAUDEWEB_SUDO_SOCKET);
let exitCode = 1;
let buffered = '';
socket.setEncoding('utf8');
socket.on('connect', () => {
  process.stderr.write('sudo: waiting for the user to allow this command in ClaudeWeb\n');
  socket.write(`${JSON.stringify({ argv, cwd: process.cwd(), stdin: stdin.toString('base64') })}\n`);
});
socket.on('data', (chunk) => {
  buffered += chunk;
  for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
    const line = buffered.slice(0, end);
    buffered = buffered.slice(end + 1);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.t === 'out') {
      (message.fd === 2 ? process.stderr : process.stdout).write(Buffer.from(String(message.data), 'base64'));
    } else if (message.t === 'exit') {
      exitCode = Number.isInteger(message.code) ? message.code : 1;
      const reason = reasons[message.outcome];
      if (reason) process.stderr.write(`sudo: ${reason}; the command did not run. Do not try again unless the user asks.\n`);
    }
  }
});
socket.on('error', (error) => {
  process.stderr.write(`sudo: ClaudeWeb is not answering (${error.code ?? error.message})\n`);
  process.exit(1);
});
socket.on('close', () => { process.exitCode = exitCode; });
