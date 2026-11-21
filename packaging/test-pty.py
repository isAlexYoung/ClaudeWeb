#!/usr/bin/env python3
"""Runs a command in a pseudo-terminal and types each answer only after the
command has printed a prompt (output ending in ": " or "] " and then quiet),
the way a person would. Used by packaging/test-domain.sh.

usage: test-pty.py <answers separated by newlines> <shell command>
Prints everything the terminal showed; exits with the command's status.
"""
import os
import pty
import select
import sys
import time

answers = sys.argv[1].split('\n')
if answers and answers[-1] == '':
    answers.pop()
pid, fd = pty.fork()
if pid == 0:
    os.execvp('bash', ['bash', '-c', sys.argv[2]])
tail = b''
deadline = time.time() + 600
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.3)
    if ready:
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.flush()
        tail = (tail + data)[-200:]
    elif answers and tail.endswith((b': ', b'] ')):
        os.write(fd, (answers.pop(0) + '\n').encode())
        tail = b''
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
