#!/usr/bin/env bash
# A published release, installed the way the README says: from the public
# install.sh, the signed list and the GitHub Release, nothing local. As root
# on a disposable Debian 12:
#   bash packaging/test-public-install.sh X.Y.Z [FROM]
# With FROM, installs that published release first and then updates to X.Y.Z
# with `claudeweb update --version=X.Y.Z`, the way a server is updated.
set -uo pipefail
VERSION="$1"
FROM="${2:-}"
FIRST="${FROM:-$VERSION}"
URL=https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh
failures=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }
cd /root

# Only meaningful while no stable release exists; then the default install takes the newest stable one.
if ! curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/releases/releases.json | grep -q '"channel": "stable"'; then
  curl -fsSL "$URL" | bash > /tmp/cw-p-default.out 2>&1
  check "without --version the installer refuses: no stable release yet" "grep -q 'no stable release is published yet' /tmp/cw-p-default.out"
fi

curl -fsSL "$URL" | bash -s -- --version="$FIRST" > /tmp/cw-p-install.out 2>&1
check "the public one-line install of $FIRST exits 0" "[[ $? -eq 0 ]]"
check "$FIRST is installed" "[[ \$(cat /opt/claudeweb/current/VERSION) == $FIRST ]]"
check "the service answers" "curl -fsS http://127.0.0.1:3001/api/auth/status >/dev/null"
check "CMCP finds standalone ClaudeWeb" "curl -fsS http://127.0.0.1:3001/api/auth/cmcp | grep -q claudeweb-cmcp"
password="$(claudeweb password)"
check "the login password works" "[[ \$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d \"{\\\"password\\\":\\\"\$password\\\",\\\"mode\\\":\\\"takeover\\\"}\" http://127.0.0.1:3001/api/auth/login) == 200 ]]"
check "the browser was installed" "ls /home/claudeweb/.cache/ms-playwright/chromium-*/chrome-linux*/chrome >/dev/null 2>&1"
check "a sudo password was set" "[[ -s /etc/claudeweb/sudo-password ]]"
if ! systemd-detect-virt --container >/dev/null 2>&1; then
  check "swap is active on the VM" "[[ \$(awk '/^SwapTotal:/ {print \$2}' /proc/meminfo) -gt 0 ]]"
fi
check "update --check works against the published list" "claudeweb update --check > /tmp/cw-p-check.out 2>&1"
if [[ -n $FROM ]]; then
  claudeweb update --version="$VERSION" > /tmp/cw-p-update.out 2>&1
  check "claudeweb update --version=$VERSION from $FROM exits 0" "[[ $? -eq 0 ]]"
  check "$VERSION is installed after the update" "[[ \$(cat /opt/claudeweb/current/VERSION) == $VERSION ]]"
  check "the service answers after the update" "curl -fsS http://127.0.0.1:3001/api/auth/status >/dev/null"
  check "the login password still works after the update" "[[ \$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d \"{\\\"password\\\":\\\"\$password\\\",\\\"mode\\\":\\\"takeover\\\"}\" http://127.0.0.1:3001/api/auth/login) == 200 ]]"
  check "$FROM is kept for rollback" "[[ -d /opt/claudeweb/releases/$FROM ]]"
  tail -n 5 /tmp/cw-p-update.out
fi
claudeweb status 2>&1 | head -n 12
echo
if (( failures == 0 )); then echo "ALL PASS"; else echo "$failures FAILED"; fi
exit $(( failures > 0 ))
