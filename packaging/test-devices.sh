#!/usr/bin/env bash
# End-to-end check of multi-device login and the CMCP code sign-in on a
# disposable Debian 12/13 / Ubuntu 22.04/24.04/26.04 amd64 machine, as root:
#   bash packaging/test-devices.sh /path/to/claudeweb-X.Y.Z-linux-x64.tar.xz
set -uo pipefail
PACKAGE="$1"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$REPO/install.sh" --package="$PACKAGE" > /tmp/cw-d-install.out 2>&1
status=$?
if (( status != 0 )); then echo "FAIL installer exits 0 ($status)"; tail -n 30 /tmp/cw-d-install.out; exit 1; fi
echo "PASS installer exits 0"
/opt/claudeweb/current/node/bin/node "$REPO/packaging/test-devices.mjs" "$(claudeweb password)"
result=$?
journalctl -u claudeweb -n 40 --no-pager > /tmp/cw-d-journal.out 2>&1
echo y | claudeweb uninstall > /dev/null 2>&1
echo
if (( result == 0 )); then echo "ALL PASS"; else echo "SOME FAILED"; fi
exit "$result"
