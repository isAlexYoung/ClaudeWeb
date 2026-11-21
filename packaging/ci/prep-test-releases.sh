#!/usr/bin/env bash
# CI only, on Debian 12 amd64 as root: builds the packages the VM tests install.
#   packaging/ci/prep-test-releases.sh OUT
# OUT gets 2.0.0 (built from HEAD), 2.0.1 (the same program under another
# version), 2.0.2 (cannot start), their .sha256 files, a public key, and two
# lists signed with it: A/ (2.0.0 stable, 2.0.1 and 2.0.2 test) and B/ (2.0.1
# promoted to stable). The key is made for this run and thrown away: the test
# packages, and the install.sh the VM runs, trust it instead of the release key.
set -euo pipefail
OUT="$(realpath -m "$1")"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEYS="$(mktemp -d)"
trap 'rm -rf "$KEYS"' EXIT
rm -rf "$OUT" && mkdir -p "$OUT"

minisign -G -W -p "$OUT/test-key.pub" -s "$KEYS/test.key" >/dev/null
TEST_KEY="$(tail -n 1 "$OUT/test-key.pub")"
[[ $TEST_KEY =~ ^RW[A-Za-z0-9+/=]+$ ]]
trust_test_key() { sed -i "s|^readonly RELEASE_PUBKEY=.*|readonly RELEASE_PUBKEY=$TEST_KEY|" "$1"; grep -q "^readonly RELEASE_PUBKEY=$TEST_KEY\$" "$1"; }

bash "$REPO/packaging/build-release.sh" --version=2.0.0 --out="$OUT/build"

# repack <version> <cannot start: yes|no>: the built 2.0.0 under another version.
repack() {
  local version=$1 work
  work="$(mktemp -d)"
  tar -xJf "$OUT/build/claudeweb-2.0.0-linux-x64.tar.xz" -C "$work"
  if [[ $version != 2.0.0 ]]; then
    mv "$work/claudeweb-2.0.0" "$work/claudeweb-$version"
    echo "$version" > "$work/claudeweb-$version/VERSION"
    for file in release.json app/package.json; do
      jq --arg v "$version" '.version = $v' "$work/claudeweb-$version/$file" > "$work/next" && mv "$work/next" "$work/claudeweb-$version/$file"
    done
    printf '{"version": "%s"}\n' "$version" > "$work/claudeweb-$version/app/claudeweb.json"
  fi
  trust_test_key "$work/claudeweb-$version/bin/claudeweb"
  if [[ $2 == yes ]]; then
    printf 'console.error("this test release cannot start"); process.exit(1);\n' > "$work/claudeweb-$version/app/dist-server/server/index.js"
  fi
  tar --owner=0 --group=0 --numeric-owner -C "$work" -cf - "claudeweb-$version" | xz -3 -T0 > "$OUT/claudeweb-$version-linux-x64.tar.xz"
  (cd "$OUT" && sha256sum "claudeweb-$version-linux-x64.tar.xz" > "claudeweb-$version-linux-x64.tar.xz.sha256")
  rm -rf "$work"
}
repack 2.0.0 no
repack 2.0.1 no
repack 2.0.2 yes
rm -rf "$OUT/build"

# The VM runs this copy of the installer.
cp "$REPO/install.sh" "$OUT/install.sh"
trust_test_key "$OUT/install.sh"

list() { python3 "$REPO/packaging/release-list.py" "$@"; }
for version in 2.0.0 2.0.1 2.0.2; do
  channel=test; [[ $version == 2.0.0 ]] && channel=stable
  list add --list "$OUT/A" --package "$OUT/claudeweb-$version-linux-x64.tar.xz" --url "file:///root/mock/claudeweb-$version-linux-x64.tar.xz" --channel "$channel"
done
list sign --list "$OUT/A" --key "$KEYS/test.key"
mkdir -p "$OUT/B" && cp "$OUT/A/releases.json" "$OUT/B/"
list promote --list "$OUT/B" --version 2.0.1
list sign --list "$OUT/B" --key "$KEYS/test.key"
minisign -Vq -p "$OUT/test-key.pub" -m "$OUT/A/releases.json"
minisign -Vq -p "$OUT/test-key.pub" -m "$OUT/B/releases.json"
ls -l "$OUT" "$OUT/A" "$OUT/B"
