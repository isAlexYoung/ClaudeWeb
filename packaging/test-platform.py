#!/usr/bin/env python3
"""Check platform admission and fail-before-switch behavior without changing a host."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
RULES = (ROOT / 'packaging/platform.sh').read_text()


def bash(body, *args):
    return subprocess.run(['bash', '-c', 'set -euo pipefail\n' + RULES + '\n' + body, 'test', *args],
                          capture_output=True, text=True)


class PlatformTest(unittest.TestCase):
    def test_exact_supported_platforms_and_signature_dependency(self):
        for os_id, version, key in [('debian', '12', 'debian-12'), ('ubuntu', '22.04', 'ubuntu-22.04')]:
            with self.subTest(key=key):
                result = bash('cw_platform_select "$1" "$2" x86_64; printf "%s\\n" "$CW_PLATFORM" "${CW_BASE_PACKAGES[*]}"', os_id, version)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.splitlines()[0], key)
                self.assertEqual('minisign' in result.stdout.splitlines()[1].split(), os_id == 'debian')

    def test_other_versions_derivatives_and_architectures_are_rejected(self):
        for os_id, version, arch in [('ubuntu', '20.04', 'x86_64'), ('ubuntu', '24.04', 'x86_64'),
                                     ('ubuntu', '26.04', 'x86_64'), ('debian', '13', 'x86_64'),
                                     ('linuxmint', '22.04', 'x86_64'), ('', '', 'x86_64'),
                                     ('ubuntu', '22.04', 'aarch64'), ('debian', '12', 'i686')]:
            with self.subTest(platform=(os_id, version, arch)):
                result = bash('cw_platform_select "$1" "$2" "$3"; echo MUST_NOT_RUN', os_id, version, arch)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('MUST_NOT_RUN', result.stdout)

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
                                               ('debian-12', '(none)', False)]:
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

    def test_package_platform_metadata_blocks_old_packages_on_ubuntu(self):
        cases = [({'os': 'debian-12'}, 'debian-12', True),
                 ({'os': 'debian-12'}, 'ubuntu-22.04', False),
                 ({'os': 'linux', 'platforms': ['debian-12', 'ubuntu-22.04']}, 'ubuntu-22.04', True),
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


if __name__ == '__main__':
    unittest.main(verbosity=2)
