#!/usr/bin/env bash
# A published release, installed the way the README says: from the public
# install.sh, the signed list and the GitHub Release, nothing local. As root
# on a disposable Debian 12:
#   bash packaging/test-public-install.sh X.Y.Z
set -uo pipefail
VERSION="$1"
URL=https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh
failures=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }
cd /root

# Only meaningful while no stable release exists; then the default install takes the newest stable one.
if ! curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/releases/releases.json | grep -q '"channel": "stable"'; then
  curl -fsSL "$URL" | bash > /tmp/cw-p-default.out 2>&1
  check "without --version the installer refuses: no stable release yet" "grep -q 'no stable release is published yet' /tmp/cw-p-default.out"
fi

curl -fsSL "$URL" | bash -s -- --version="$VERSION" > /tmp/cw-p-install.out 2>&1
check "the public one-line install of $VERSION exits 0" "[[ $? -eq 0 ]]"
check "$VERSION is installed" "[[ \$(cat /opt/claudeweb/current/VERSION) == $VERSION ]]"
check "the service answers" "curl -fsS http://127.0.0.1:3001/api/auth/status >/dev/null"
check "CMCP finds standalone ClaudeWeb" "curl -fsS http://127.0.0.1:3001/api/auth/cmcp | grep -q claudeweb-cmcp"
password="$(claudeweb password)"
check "the login password works" "[[ \$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d \"{\\\"password\\\":\\\"\$password\\\",\\\"mode\\\":\\\"takeover\\\"}\" http://127.0.0.1:3001/api/auth/login) == 200 ]]"
check "the browser was installed" "ls /home/claudeweb/.cache/ms-playwright/chromium-*/chrome-linux*/chrome >/dev/null 2>&1"
check "a sudo password was set" "[[ -s /etc/claudeweb/sudo-password ]]"
check "update --check works against the published list" "claudeweb update --check > /tmp/cw-p-check.out 2>&1"
claudeweb status 2>&1 | head -n 12
echo
if (( failures == 0 )); then echo "ALL PASS"; else echo "$failures FAILED"; fi
exit $(( failures > 0 ))
