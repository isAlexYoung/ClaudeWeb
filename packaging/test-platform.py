#!/usr/bin/env python3
"""Check platform admission and fail-before-switch behavior without changing a host."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
RULES = (ROOT / 'packaging/platform.sh').read_text()


def bash(body, *args, rules=RULES):
    return subprocess.run(['bash', '-c', 'set -euo pipefail\n' + rules + '\n' + body, 'test', *args],
                          capture_output=True, text=True)


class PlatformTest(unittest.TestCase):
    def test_exact_supported_platforms_and_signature_dependency(self):
        for os_id, version, key in [('debian', '12', 'debian-12'), ('debian', '13', 'debian-13'),
                                    ('ubuntu', '22.04', 'ubuntu-22.04'),
                                    ('ubuntu', '24.04', 'ubuntu-24.04'), ('ubuntu', '26.04', 'ubuntu-26.04')]:
            with self.subTest(key=key):
                result = bash('cw_platform_select "$1" "$2" x86_64; printf "%s\\n" "$CW_PLATFORM" "${CW_BASE_PACKAGES[*]}"', os_id, version)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.splitlines()[0], key)
                self.assertEqual('minisign' in result.stdout.splitlines()[1].split(), key != 'ubuntu-22.04')
                self.assertIn('python3', result.stdout.splitlines()[1].split(), 'the CMCP connector needs Python on every supported platform')

    def test_other_versions_derivatives_and_architectures_are_rejected(self):
        for os_id, version, arch in [('ubuntu', '20.04', 'x86_64'), ('ubuntu', '24.10', 'x86_64'),
                                     ('ubuntu', '26.10', 'x86_64'), ('debian', '14', 'x86_64'),
                                     ('debian', 'testing', 'x86_64'), ('debian', '13', 'aarch64'),
                                     ('linuxmint', '22.04', 'x86_64'), ('', '', 'x86_64'),
                                     ('ubuntu', '22.04', 'aarch64'), ('ubuntu', '24.04', 'aarch64'),
                                     ('ubuntu', '26.04', 'aarch64'), ('debian', '12', 'i686')]:
            with self.subTest(platform=(os_id, version, arch)):
                result = bash('cw_platform_select "$1" "$2" "$3"; echo MUST_NOT_RUN', os_id, version, arch)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('MUST_NOT_RUN', result.stdout)

    def test_trixie_uses_t64_audio_without_ubuntu_policy(self):
        result = bash('''
cw_platform_select debian 13 x86_64
printf '%s\\n' "${CW_GUI_PACKAGES[*]}"
apparmor_parser() { echo UNEXPECTED_POLICY; return 1; }
cw_configure_graphical_sandbox
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('libasound2t64', result.stdout.split())
        self.assertNotIn('libasound2', result.stdout.split())
        self.assertNotIn('UNEXPECTED_POLICY', result.stdout)

    def test_os_release_does_not_overwrite_requested_product_version(self):
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory) / 'os-release'
            release.write_text('ID=ubuntu\nID_LIKE=debian\nVERSION_ID="22.04"\nVERSION="22.04.5 LTS"\n')
            result = bash('VERSION=9.8.7; cw_platform_detect "$1"; printf "%s %s" "$VERSION" "$CW_PLATFORM"', str(release))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, '9.8.7 ubuntu-22.04')

    def test_missing_os_release_is_actionable(self):
        result = bash('cw_platform_detect /does-not-exist; echo MUST_NOT_RUN')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cannot read', result.stderr)
        self.assertNotIn('MUST_NOT_RUN', result.stdout)

    def test_universe_is_enabled_only_when_the_graphics_candidate_is_missing(self):
        for platform, candidate, expected in [('ubuntu-22.04', '(none)', True),
                                               ('ubuntu-22.04', '1.12.0', False),
                                               ('ubuntu-24.04', '(none)', True),
                                               ('ubuntu-24.04', '1.13.1', False),
                                               ('ubuntu-26.04', '(none)', True),
                                               ('ubuntu-26.04', '1.15.0', False),
                                               ('debian-12', '(none)', False),
                                               ('debian-13', '(none)', False)]:
            with self.subTest(platform=platform, candidate=candidate):
                result = bash('''
CW_PLATFORM=$1
apt-get() { printf 'APT %s\\n' "$*"; }
add-apt-repository() { printf 'REPOSITORY %s\\n' "$*"; }
candidate=$2
apt-cache() { printf '  Candidate: %s\\n' "$candidate"; }
cw_prepare_apt
''', platform, candidate)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual('REPOSITORY -y universe' in result.stdout, expected)
                self.assertEqual('software-properties-common' in result.stdout, expected)

    def test_bad_minisign_bootstrap_is_refused_before_extract_or_install(self):
        result = bash('''
CW_PLATFORM=ubuntu-22.04
cw_minisign() { return 1; }
curl() {
  while (( $# )); do
    if [[ $1 == -o ]]; then printf 'corrupt download' > "$2"; return 0; fi
    shift
  done
  return 1
}
tar() { echo UNSAFE_EXTRACT; }
install() { echo UNSAFE_INSTALL; }
cw_ensure_minisign
''')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('checksum mismatch', result.stderr)
        self.assertNotIn('UNSAFE_', result.stdout)

    def test_package_platform_metadata_blocks_old_packages_on_new_targets(self):
        cases = [({'os': 'debian-12'}, 'debian-12', True),
                 ({'os': 'debian-12'}, 'debian-13', False),
                 ({'os': 'debian-12'}, 'ubuntu-22.04', False),
                 ({'os': 'debian-12'}, 'ubuntu-24.04', False),
                 ({'os': 'linux', 'platforms': ['debian-12', 'ubuntu-22.04']}, 'ubuntu-22.04', True),
                 ({'platforms': ['debian-12', 'ubuntu-22.04']}, 'ubuntu-24.04', False),
                 ({'platforms': ['debian-12', 'ubuntu-22.04', 'ubuntu-24.04']}, 'ubuntu-24.04', True),
                 ({'platforms': ['debian-12', 'ubuntu-22.04', 'ubuntu-24.04']}, 'ubuntu-26.04', False),
                 ({'platforms': ['debian-12', 'ubuntu-22.04', 'ubuntu-24.04', 'ubuntu-26.04']}, 'ubuntu-26.04', True),
                 ({'platforms': ['debian-12', 'ubuntu-22.04', 'ubuntu-24.04', 'ubuntu-26.04']}, 'debian-13', False),
                 ({'platforms': ['debian-12', 'debian-13', 'ubuntu-22.04', 'ubuntu-24.04', 'ubuntu-26.04']}, 'debian-13', True),
                 ({'platforms': ['debian-12']}, 'ubuntu-22.04', False),
                 ({'os': 'debian-12', 'platforms': []}, 'debian-12', False)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for metadata, platform, allowed in cases:
                with self.subTest(metadata=metadata, platform=platform):
                    (root / 'release.json').write_text(json.dumps(metadata))
                    result = bash('CW_PLATFORM=$2; cw_check_release_platform "$1"; echo CAN_SWITCH', directory, platform)
                    self.assertEqual(result.returncode == 0, allowed, result.stderr)
                    self.assertEqual('CAN_SWITCH' in result.stdout, allowed)

    def test_native_probe_failure_blocks_switching(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'release.json').write_text('{"platforms":["ubuntu-22.04"]}')
            (root / 'share').mkdir()
            (root / 'node/bin').mkdir(parents=True)
            (root / 'share/check-runtime.cjs').touch()
            node = root / 'node/bin/node'
            node.write_text('#!/bin/sh\necho "GLIBC version unavailable" >&2\nexit 1\n')
            node.chmod(0o755)
            result = bash('CW_PLATFORM=ubuntu-22.04; cw_check_release_platform "$1"; echo CAN_SWITCH', directory)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('CAN_SWITCH', result.stdout)

    def test_standalone_scripts_embed_the_current_rules(self):
        result = subprocess.run(['python3', str(ROOT / 'packaging/sync-platform.py'), '--check'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_apparmor_policy_has_only_graphical_executable_attachments(self):
        result = bash('cw_graphical_apparmor_profile')
        self.assertEqual(result.returncode, 0, result.stderr)
        profiles = [line for line in result.stdout.splitlines() if line.startswith('profile ')]
        self.assertEqual(len(profiles), 1)
        self.assertIn('/home/claudeweb/.cache/ms-playwright/chromium-[0-9]*/chrome-linux{,64}/chrome', profiles[0])
        self.assertNotIn('/usr/lib/claude-desktop/claude-desktop', result.stdout)
        self.assertNotIn('/**', result.stdout)
        self.assertNotIn('sysctl', result.stdout)
        self.assertNotIn('no-sandbox', result.stdout)

    @unittest.skipUnless(os.geteuid() == 0, 'profile ownership check requires root in a private fixture')
    def test_apparmor_load_repair_and_uninstall_preserve_unmanaged_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            enabled = root / 'enabled'
            enabled.write_text('Y\n')
            policy_dir = root / 'apparmor.d'
            policy_dir.mkdir()
            policy = policy_dir / 'claudeweb-graphical'
            official = policy_dir / 'claude-desktop'
            official.write_text('# official package policy\n')
            rules = RULES.replace('/etc/apparmor.d', str(policy_dir)).replace(
                '/sys/module/apparmor/parameters/enabled', str(enabled))
            prefix = 'CW_PLATFORM=ubuntu-24.04; apparmor_parser() { echo "PARSER $*"; }; '
            result = bash(prefix + 'cw_configure_graphical_sandbox', rules=rules)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('PARSER -Q -T', result.stdout)
            self.assertIn('PARSER -r -T', result.stdout)
            self.assertEqual(policy.stat().st_mode & 0o777, 0o644)
            self.assertEqual(policy.stat().st_uid, 0)
            self.assertEqual(bash(prefix + 'cw_configure_graphical_sandbox', rules=rules).returncode, 0)
            resolute = prefix.replace('ubuntu-24.04', 'ubuntu-26.04')
            self.assertEqual(bash(resolute + 'cw_configure_graphical_sandbox', rules=rules).returncode, 0)
            result = bash(prefix + 'cw_remove_graphical_sandbox', rules=rules)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('PARSER -R', result.stdout)
            self.assertFalse(policy.exists())
            self.assertEqual(official.read_text(), '# official package policy\n')
            policy.write_text('# administrator policy\n')
            result = bash(prefix + 'cw_configure_graphical_sandbox', rules=rules)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('not managed', result.stderr)
            self.assertEqual(bash(prefix + 'cw_remove_graphical_sandbox', rules=rules).returncode, 0)
            self.assertEqual(policy.read_text(), '# administrator policy\n')
            policy.unlink()
            policy.symlink_to(enabled)
            self.assertNotEqual(bash(prefix + 'cw_configure_graphical_sandbox', rules=rules).returncode, 0)
            self.assertEqual(enabled.read_text(), 'Y\n')

    @unittest.skipUnless(os.geteuid() == 0, 'profile ownership check requires root in a private fixture')
    def test_apparmor_parser_failure_leaves_existing_policy_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'enabled').write_text('Y\n')
            (root / 'apparmor.d').mkdir()
            policy = root / 'apparmor.d/claudeweb-graphical'
            original = '# Managed by ClaudeWeb: graphical user namespaces (schema 1).\n# previous policy\n'
            policy.write_text(original)
            rules = RULES.replace('/etc/apparmor.d', str(root / 'apparmor.d')).replace(
                '/sys/module/apparmor/parameters/enabled', str(root / 'enabled'))
            for failure in ['-Q', '-r']:
                result = bash('CW_PLATFORM=ubuntu-24.04; failure=$1; '
                              'apparmor_parser() { [[ $1 != "$failure" ]]; }; '
                              'cw_configure_graphical_sandbox', failure, rules=rules)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(policy.read_text(), original)


if __name__ == '__main__':
    unittest.main(verbosity=2)
