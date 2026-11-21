#!/usr/bin/env bash
# End-to-end check of the built-in browser on a disposable Debian 12 machine, as root:
#   bash packaging/test-browser.sh /path/to/claudeweb-X.Y.Z-linux-x64.tar.xz
set -uo pipefail
PACKAGE="$1"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }

bash "$REPO/install.sh" --package="$PACKAGE" > /tmp/cw-b-install.out 2>&1
check "installer exits 0" "[[ $? -eq 0 ]]"
check "the installer installed the browser" "grep -q 'Installing the browser' /tmp/cw-b-install.out && ! grep -q 'browser could not be installed' /tmp/cw-b-install.out"
check "Playwright's Chromium is in the service account's cache" "ls /home/claudeweb/.cache/ms-playwright/chromium-*/chrome-linux*/chrome >/dev/null 2>&1"
check "Chinese fonts are installed" "fc-list :lang=zh | grep -qi noto"
password="$(claudeweb password)"
token="$(curl -s -H 'content-type: application/json' -d "{\"password\":\"$password\",\"mode\":\"takeover\"}" http://127.0.0.1:3001/api/auth/login | jq -r .token)"

/opt/claudeweb/current/node/bin/node "$REPO/packaging/test-browser.mjs" "$token" > /tmp/cw-b-node.out 2>&1 &
node_pid=$!
# While the browser is open: it runs as claudeweb with its input method, and the display is private.
for _ in $(seq 1 120); do pgrep -u claudeweb -f 'ms-playwright/chromium' >/dev/null && break; sleep 1; done
sleep 3
check "Chromium runs as claudeweb" "pgrep -u claudeweb -f 'ms-playwright/chromium' >/dev/null"
check "nothing of the browser runs as root" "! pgrep -u root -f 'ms-playwright|Xtigervnc' >/dev/null"
check "the Chinese input method runs" "pgrep -u claudeweb -x fcitx5 >/dev/null"
check "the display listens on no TCP port" "! ss -ltnp | grep -q Xtigervnc"
check "the picture socket is private to claudeweb" "[[ \$(stat -c '%U %a' /home/claudeweb/.cache/claudeweb-browser/vnc.sock) == 'claudeweb 600' ]]"
wait "$node_pid"
node_status=$?
cat /tmp/cw-b-node.out
check "the panel checks pass" "[[ $node_status -eq 0 ]]"
sleep 3
check "no Chromium is left after the panel closed" "! pgrep -u claudeweb -f 'ms-playwright/chromium' >/dev/null"
check "no display is left after the panel closed" "! pgrep -u claudeweb -x Xtigervnc >/dev/null"
check "the service is still running" "systemctl is-active --quiet claudeweb"
journalctl -u claudeweb -n 30 --no-pager > /tmp/cw-b-journal.out 2>&1

echo y | claudeweb uninstall > /dev/null 2>&1
echo
if (( failures == 0 )); then echo "ALL PASS"; else echo "$failures FAILED"; fi
exit $(( failures > 0 ))
