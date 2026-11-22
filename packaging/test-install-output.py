#!/usr/bin/env python3
"""Exercise the real standalone installer's output helpers without installing anything.

Run with Python 3 on Linux/WSL. The fixture uses a private temporary log, real Bash
redirection and exit traps; it never changes packages, services or user accounts.
"""
import os
from pathlib import Path
import pty
import re
import select
import shlex
import subprocess
import tempfile
import time
import unittest


INSTALLER = (Path(__file__).resolve().parent.parent / 'install.sh').read_text()
HELPERS = INSTALLER[INSTALLER.index('VERSION=""'):INSTALLER.index('\nfor argument in "$@"; do')]


class InstallerOutputTest(unittest.TestCase):
    def run_installer_helpers(self, body, *, columns='80', previous_log=''):
        with tempfile.TemporaryDirectory(prefix='claudeweb-install-output-') as directory:
            log = Path(directory) / 'install.log'
            log.write_text(previous_log)
            env = {**os.environ, 'LOG_DIR': directory, 'INSTALL_LOG': str(log), 'COLUMNS': columns}
            process = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + HELPERS + '\n' + body],
                                     env=env, text=True, capture_output=True)
            return process, log.read_text(), log.stat().st_mode & 0o777

    def test_download_noise_is_logged_and_passwords_remain_console_only(self):
        result, log, mode = self.run_installer_helpers('''
step "Checking this server"
start_logging
step "Installing packages"
for n in $(seq 1 100); do printf 'Downloaded package %s\n' "$n"; done
printf 'dependency stderr details\n' >&2
say "ClaudeWeb is running."
printf 'Login password: output-test-secret\n' >&3
print_welcome
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('[01/15] Checking this server', result.stdout)
        self.assertIn('[02/15] Installing packages', result.stdout)
        self.assertNotIn('Downloaded package', result.stdout)
        self.assertNotIn('dependency stderr', result.stdout)
        self.assertIn('Downloaded package 100', log)
        self.assertIn('dependency stderr details', log)
        self.assertIn('output-test-secret', result.stdout)
        self.assertNotIn('output-test-secret', log)
        self.assertIn('welcome to', result.stdout)
        self.assertIn('/ ___|', result.stdout)
        self.assertNotIn('\x1b', result.stdout + log)
        self.assertEqual(mode, 0o600)

    def test_failure_reports_stage_log_path_and_recent_error_without_welcome(self):
        result, log, _ = self.run_installer_helpers('''
start_logging
step "Installing packages"
bash -c 'echo "Download failed: simulated connection reset" >&2; exit 42'
print_welcome
''')
        self.assertEqual(result.returncode, 42)
        self.assertIn('Installing packages (exit 42)', result.stdout)
        self.assertIn('simulated connection reset', result.stdout)
        self.assertIn('Details are in ', result.stdout)
        self.assertIn('/install.log', result.stdout)
        self.assertNotIn('welcome to', result.stdout)
        self.assertIn('simulated connection reset', log)

    def test_preflight_failure_does_not_read_an_older_installation_log(self):
        result, _, _ = self.run_installer_helpers('step "Checking this server"\nfail "not supported"',
                                                 previous_log='unrelated previous installation output\n')
        self.assertEqual(result.returncode, 1)
        self.assertIn('not supported', result.stderr)
        self.assertNotIn('unrelated previous', result.stdout + result.stderr)
        self.assertNotIn('welcome to', result.stdout)

    def test_explicit_interactive_output_is_visible_and_bypasses_the_log(self):
        result, log, _ = self.run_installer_helpers('''
start_logging
bash -c 'echo "Configure a domain?"; echo "interactive error details" >&2' >&3 2>&3
''')
        self.assertEqual(result.returncode, 0)
        self.assertIn('Configure a domain?', result.stdout)
        self.assertIn('interactive error details', result.stdout)
        self.assertNotIn('Configure a domain?', log)
        self.assertNotIn('interactive error details', log)

    def test_narrow_terminal_has_an_unwrapped_title(self):
        result, _, _ = self.run_installer_helpers('start_logging\nprint_welcome', columns='020')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('\nCLAUDEWEB\n', result.stdout)
        self.assertNotIn('/ ___|', result.stdout)
        self.assertTrue(all(len(line) <= 20 for line in result.stdout.splitlines()))

    def test_terminal_prompts_and_banner_keep_secrets_and_ansi_out_of_the_log(self):
        with tempfile.TemporaryDirectory(prefix='claudeweb-install-tty-') as directory:
            log = Path(directory) / 'install.log'
            script = Path(directory) / 'fixture.sh'
            script.write_text('set -euo pipefail\n' + HELPERS + '''
start_logging
bash -c 'read -rs -p "Cloudflare token: " answer </dev/tty; printf "\nInput received.\n"' >&3 2>&3
print_welcome
''')
            pid, fd = pty.fork()
            if pid == 0:
                os.execvpe('bash', ['bash', str(script)],
                          {**os.environ, 'LOG_DIR': directory, 'INSTALL_LOG': str(log),
                           'TERM': 'xterm-256color', 'COLUMNS': '80'})
            output, answered = b'', False
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if not select.select([fd], [], [], 0.1)[0]:
                        continue
                    try:
                        data = os.read(fd, 4096)
                    except OSError:
                        break
                    if not data:
                        break
                    output += data
                    if not answered and b'Cloudflare token: ' in output:
                        os.write(fd, b'hidden-output-test-secret\n')
                        answered = True
                else:
                    os.kill(pid, 9)
                    self.fail('interactive prompt did not finish')
            finally:
                os.close(fd)
                _, status = os.waitpid(pid, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 0, output)
            self.assertTrue(answered)
            self.assertIn(b'Input received.', output)
            self.assertNotIn(b'hidden-output-test-secret', output)
            self.assertNotIn('hidden-output-test-secret', log.read_text())
            self.assertEqual(output.count(b'\x1b[38;2;224;176;157m'), 3)
            self.assertEqual(output.count(b'\x1b[38;2;255;255;255m'), 2)
            self.assertEqual(output.count(b'\x1b[0m'), 5)
            self.assertNotIn('\x1b', log.read_text())

    def test_stage_total_matches_the_installer_and_banner_is_last(self):
        total = int(re.search(r'readonly STEP_TOTAL=(\d+)', HELPERS).group(1))
        self.assertEqual(len(re.findall(r'^step "', INSTALLER, re.M)), total)
        self.assertEqual(INSTALLER.rstrip().splitlines()[-1], 'print_welcome')

    def test_redirected_output_skips_domain_even_with_a_controlling_terminal(self):
        branch = INSTALLER[INSTALLER.index('DOMAIN_STATE="$ETC_DIR/domain.json"'):INSTALLER.index('# Old release folders')]
        with tempfile.TemporaryDirectory(prefix='claudeweb-domain-output-') as directory:
            root = Path(directory)
            (root / 'bin').mkdir()
            command = root / 'bin/claudeweb'
            command.write_text('#!/bin/sh\ntouch "$MARKER"\n')
            command.chmod(0o755)
            fixture = root / 'fixture.sh'
            fixture.write_text('set -euo pipefail\nexec >"$CAPTURE" 2>&1\n' + HELPERS + '\nstart_logging\n' + branch)
            env = {**os.environ, 'LOG_DIR': directory, 'INSTALL_LOG': str(root / 'install.log'),
                   'ETC_DIR': directory, 'CURRENT': directory, 'MARKER': str(root / 'prompt-called'),
                   'CAPTURE': str(root / 'capture.txt')}
            result = subprocess.run(['script', '-q', '-e', '-c', 'bash ' + shlex.quote(str(fixture)), '/dev/null'],
                                    env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((root / 'prompt-called').exists(), 'a hidden prompt would stall unattended installation')
            self.assertIn('set up a domain later', (root / 'capture.txt').read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
