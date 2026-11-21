#!/usr/bin/env bash
# Builds a ClaudeWeb release package on Debian 12 amd64:
#   claudeweb-<version>-linux-x64.tar.xz and its .sha256
# The package carries its own Node.js, the built app with production
# dependencies (native modules compiled for that Node), the `claudeweb`
# management command and the systemd unit. Servers only unpack it.
#
# Usage: packaging/build-release.sh --version=2.0.0 [--out=DIR] [--channel=test|stable]
# Needs: curl, xz-utils, tar, python3, build-essential (for native modules).
set -euo pipefail

NODE_VERSION=22.23.2   # ABI 127; native modules are built for exactly this Node.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=""
OUT="$REPO_ROOT/release-out"
CHANNEL=test

for argument in "$@"; do
  case "$argument" in
    --version=*) VERSION="${argument#--version=}" ;;
    --out=*) OUT="${argument#--out=}" ;;
    --channel=*) CHANNEL="${argument#--channel=}" ;;
    *) echo "Unknown option: $argument" >&2; exit 2 ;;
  esac
done
[[ "$VERSION" =~ ^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$ ]] || { echo "--version=X.Y.Z is required" >&2; exit 2; }
[[ "$CHANNEL" == test || "$CHANNEL" == stable ]] || { echo "--channel must be test or stable" >&2; exit 2; }
[[ "$(uname -m)" == x86_64 ]] || { echo "Build on amd64 (x86_64)." >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
NAME="claudeweb-$VERSION"
STAGE="$WORK/$NAME"
mkdir -p "$STAGE" "$OUT"

echo "== Node.js $NODE_VERSION"
node_archive="node-v$NODE_VERSION-linux-x64.tar.xz"
curl -fsSL --retry 5 -o "$WORK/$node_archive" "https://nodejs.org/dist/v$NODE_VERSION/$node_archive"
curl -fsSL --retry 5 -o "$WORK/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
(cd "$WORK" && grep " $node_archive\$" SHASUMS256.txt | sha256sum -c -)
mkdir -p "$STAGE/node"
tar -xJf "$WORK/$node_archive" -C "$STAGE/node" --strip-components=1
rm -rf "$STAGE/node/include" "$STAGE/node/share"
export PATH="$STAGE/node/bin:$PATH"
[[ "$(node -p process.versions.modules)" == 127 ]]

echo "== App"
# The committed tree only: no node_modules, build output or uncommitted edits.
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- app packaging)" ]]; then
  echo "warning: app/ or packaging/ has uncommitted changes; they are not in the package" >&2
fi
git -C "$REPO_ROOT" archive --format=tar HEAD app packaging | tar -x -C "$STAGE"
mv "$STAGE/packaging" "$WORK/packaging"
cd "$STAGE/app"
node -e "const f='package.json',p=JSON.parse(require('fs').readFileSync(f));p.version='$VERSION';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
npm ci --no-audit --no-fund --loglevel=error --fetch-retries=5 --fetch-retry-maxtimeout=120000
VITE_BASE_PATH=/ npm run build --silent
npm prune --omit=dev --no-audit --no-fund --loglevel=error
npm ci --prefix tools/taskmaster --omit=dev --omit=optional --no-audit --no-fund --loglevel=error --fetch-retries=5 --fetch-retry-maxtimeout=120000
node tools/taskmaster/node_modules/task-master-ai/dist/task-master.js --version
npm ci --prefix bundled-plugins/claude-usage --include=dev --no-audit --no-fund --loglevel=error
node bundled-plugins/claude-usage/node_modules/typescript/bin/tsc -p bundled-plugins/claude-usage/tsconfig.json
npm prune --prefix bundled-plugins/claude-usage --omit=dev --no-audit --no-fund --loglevel=error
# Files the service never reads: other platforms' binaries, native-module
# sources only needed to compile, unused figlet fonts, the SDK's own Claude
# binaries (ClaudeWeb runs the installed Claude CLI), development sources.
rm -rf node_modules/node-pty/prebuilds/darwin-* node_modules/node-pty/prebuilds/win32-*
rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src
rm -rf tools/taskmaster/node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/*-darwin
rm -rf tools/taskmaster/node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/*-win32
rm -rf tools/taskmaster/node_modules/figlet/importable-fonts
find tools/taskmaster/node_modules/figlet/fonts -type f ! -name Standard.flf -delete
rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-x64 node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl
rm -rf src tests coverage .agents
test -f dist/index.html
test -f dist-server/server/index.js
test -f dist-server/server/modules/cli/cli.js

echo "== Management files"
mkdir -p "$STAGE/bin" "$STAGE/share"
cp "$WORK/packaging/claudeweb" "$STAGE/bin/claudeweb"
chmod 0755 "$STAGE/bin/claudeweb"
cp "$WORK/packaging/claudeweb.service" "$WORK/packaging/claudeweb-update.socket" "$WORK/packaging/claudeweb-update@.service" \
  "$WORK/packaging/playwright-version" "$STAGE/share/"
git -C "$REPO_ROOT" archive --format=tar HEAD LICENSE NOTICE THIRD_PARTY_NOTICES.md | tar -x -C "$STAGE"
source_commit="$(git -C "$REPO_ROOT" rev-parse HEAD)"
python3 - "$STAGE/release.json" "$VERSION" "$CHANNEL" "$source_commit" "$NODE_VERSION" <<'EOF'
import json, sys
path, version, channel, commit, node = sys.argv[1:]
json.dump({"version": version, "channel": channel, "source_commit": commit,
           "node": node, "node_abi": "127", "arch": "x64", "os": "debian-12"},
          open(path, "w"), indent=1)
EOF
echo "$VERSION" > "$STAGE/VERSION"
# Settings > About reads the installed version from here.
printf '{"version": "%s"}\n' "$VERSION" > "$STAGE/app/claudeweb.json"

echo "== Package"
archive="$OUT/$NAME-linux-x64.tar.xz"
mtime="@$(git -C "$REPO_ROOT" log -1 --format=%ct)"
tar --owner=0 --group=0 --numeric-owner --sort=name --mtime="$mtime" -C "$WORK" -cf - "$NAME" | xz -9 -T0 > "$archive"
(cd "$OUT" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
echo "built $archive ($(du -m "$archive" | cut -f1) MB, unpacked $(du -sm "$STAGE" | cut -f1) MB)"
