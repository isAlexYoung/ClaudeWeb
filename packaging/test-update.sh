#!/usr/bin/env bash
# End-to-end check of signed releases, `claudeweb update` and `claudeweb rollback`
# on a disposable Debian 12/13 / Ubuntu 22.04/24.04/26.04 amd64 machine, as root:
#   bash packaging/test-update.sh /path/to/mock
# MOCK holds 2.0.0, 2.0.1, a 2.0.2 that cannot start, an incompatible 2.0.3, and two
# signed lists: A/ (2.0.0 stable, 2.0.1 and 2.0.2 test) and B/ (2.0.1 promoted).
# The lists name packages as file:///root/mock/<name>. The lists themselves are
# served from /srv: the web request service has ProtectHome and cannot read /root.
set -uo pipefail
SOURCE="$1"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK=/root/mock
LISTS=/srv/cw-mock
failures=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }
use_list() { cp "$SOURCE/$1/releases.json" "$SOURCE/$1/releases.json.minisig" "$LISTS/"; }
version() { cat /opt/claudeweb/current/VERSION; }
token_ok() { [[ $(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $1" http://127.0.0.1:3001/api/auth/user) == 200 ]]; }

rm -rf "$MOCK" "$LISTS" && mkdir -p "$MOCK" "$LISTS"
cp "$SOURCE"/claudeweb-*-linux-x64.tar.xz "$MOCK/"
use_list A

echo "== install the latest stable release from the signed list"
CLAUDEWEB_RELEASES_URL=file://$LISTS bash "$REPO/install.sh" > /tmp/cw-u-install.out 2>&1
check "installer exits 0" "[[ $? -eq 0 ]]"
check "the latest stable (2.0.0) was installed, not the newer test release" "[[ \$(version) == 2.0.0 ]]"
password="$(claudeweb password)"
token="$(curl -s -H 'content-type: application/json' -d "{\"password\":\"$password\",\"mode\":\"takeover\"}" http://127.0.0.1:3001/api/auth/login | jq -r .token)"
check "signed in" "[[ -n \$token && \$token != null ]]"

echo "== update --check sees no newer stable release"
check "update --check: up to date" "claudeweb update --check | grep -q 'up to date'"

echo "== a signed package for another platform leaves the running version alone"
claudeweb update --version=2.0.3 > /tmp/cw-u-platform.out 2>&1
check "an incompatible signed package is refused" "[[ $? -ne 0 ]] && [[ \$(jq -r .error /run/claudeweb-update/status.json) == CLAUDEWEB_PLATFORM_INCOMPATIBLE ]]"
check "the old service keeps running after platform refusal" "[[ \$(version) == 2.0.0 ]] && systemctl is-active --quiet claudeweb && token_ok \"\$token\""
check "the incompatible package was not installed or switched" "[[ ! -e /opt/claudeweb/releases/2.0.3 && ! -e /var/lib/claudeweb-update/state.json ]]"

echo "== update to a test release"
claudeweb update --version=2.0.1 > /tmp/cw-u1.out 2>&1
check "update to 2.0.1 exits 0" "[[ $? -eq 0 ]]"
check "2.0.1 is running" "[[ \$(version) == 2.0.1 ]] && systemctl is-active --quiet claudeweb"
check "the session survives the update" "token_ok \"\$token\""
check "the database was copied before switching" "ls /var/lib/claudeweb-update/backups/2.0.0-*/auth.db >/dev/null 2>&1"
check "install.json names 2.0.0 as previous" "[[ \$(jq -r .previous /etc/claudeweb/install.json) == 2.0.0 ]]"
check "no update state is left" "[[ ! -e /var/lib/claudeweb-update/state.json ]]"

echo "== rollback"
claudeweb rollback > /tmp/cw-u2.out 2>&1
check "rollback exits 0" "[[ $? -eq 0 ]]"
check "2.0.0 is running again" "[[ \$(version) == 2.0.0 ]] && systemctl is-active --quiet claudeweb"
check "the session survives the rollback" "token_ok \"\$token\""

echo "== a release that cannot start is undone automatically"
claudeweb update --version=2.0.2 > /tmp/cw-u3.out 2>&1
check "update to 2.0.2 fails" "[[ $? -ne 0 ]]"
check "2.0.0 is running after the failed update" "[[ \$(version) == 2.0.0 ]] && systemctl is-active --quiet claudeweb"
check "the failed update says what happened" "grep -q 'running again' /tmp/cw-u3.out"
check "no update state is left after the automatic return" "[[ ! -e /var/lib/claudeweb-update/state.json ]]"

echo "== a changed list is refused"
cp "$LISTS/releases.json" /tmp/cw-list.json
sed -i 's/"notes": ""/"notes": "changed"/' "$LISTS/releases.json"
claudeweb update --check > /tmp/cw-u4.out 2>&1
check "a list edited after signing is refused" "[[ $? -ne 0 ]] && grep -q 'signature is not valid' /tmp/cw-u4.out"
cp /tmp/cw-list.json "$LISTS/releases.json"

echo "== a changed package is refused"
rm -rf /opt/claudeweb/releases/2.0.1
cp "$MOCK/claudeweb-2.0.1-linux-x64.tar.xz" /tmp/cw-pkg.tar.xz
printf 'x' >> "$MOCK/claudeweb-2.0.1-linux-x64.tar.xz"
claudeweb update --version=2.0.1 > /tmp/cw-u5.out 2>&1
check "a package that does not match the list is refused" "[[ $? -ne 0 ]] && grep -Eq 'wrong size|does not match' /tmp/cw-u5.out"
check "nothing changed after the refused package" "[[ \$(version) == 2.0.0 ]] && [[ ! -e /opt/claudeweb/releases/2.0.1 ]]"
cp /tmp/cw-pkg.tar.xz "$MOCK/claudeweb-2.0.1-linux-x64.tar.xz"

echo "== an unfinished update blocks updates until rollback"
printf '{"from": "2.0.0", "to": "2.0.1", "phase": "switching"}\n' > /var/lib/claudeweb-update/state.json
claudeweb update --check > /tmp/cw-u6.out 2>&1
check "update refuses while an update is unfinished" "[[ $? -ne 0 ]] && grep -q 'claudeweb rollback' /tmp/cw-u6.out"
claudeweb rollback > /tmp/cw-u7.out 2>&1
check "rollback clears the unfinished update" "[[ $? -eq 0 ]] && [[ ! -e /var/lib/claudeweb-update/state.json ]] && systemctl is-active --quiet claudeweb"
check "help mentions rollback for unfinished updates" "claudeweb help | grep -q 'unfinished'"

echo "== Settings > About: the web page updates through the root socket"
api() { curl -s -H "authorization: Bearer $token" -H 'content-type: application/json' "$@"; }
check "the page sees that updates are supported" "[[ \$(api http://127.0.0.1:3001/api/claudeweb-update/status | jq -r .supported) == true ]]"
check "the page shows the installed version" "[[ \$(api http://127.0.0.1:3001/api/claudeweb-update/status | jq -r .installed) == 2.0.0 ]]"
echo "check with list A: $(api -X POST http://127.0.0.1:3001/api/claudeweb-update/check)"
check "with list A the page offers nothing (2.0.1 is a test release)" "[[ \$(api -X POST http://127.0.0.1:3001/api/claudeweb-update/check | jq -r 'if has(\"newer\") then (.newer | length) else \"error\" end') == 0 ]]"
check "the page cannot start a test release" "api -X POST -d '{\"version\":\"2.0.1\"}' http://127.0.0.1:3001/api/claudeweb-update/update | grep -q CLAUDEWEB_NOT_NEWER"
use_list B
check "after promotion the page offers 2.0.1" "[[ \$(api -X POST http://127.0.0.1:3001/api/claudeweb-update/check | jq -r '.newer[0].version') == 2.0.1 ]]"
echo "check with list B: $(api -X POST http://127.0.0.1:3001/api/claudeweb-update/check)"
check "the page starts the update" "[[ \$(api -X POST -d '{\"version\":\"2.0.1\"}' http://127.0.0.1:3001/api/claudeweb-update/update | jq -r .started) == true ]]"
state=""
for _ in $(seq 1 180); do
  state="$(api http://127.0.0.1:3001/api/claudeweb-update/status 2>/dev/null | jq -r '.status.state + " " + (.installed // "")' 2>/dev/null)"
  [[ $state == 'done 2.0.1' || $state == failed* ]] && break
  sleep 1
done
echo "web update ended as: $state"
check "the web update finished with 2.0.1 running" "[[ \$state == 'done 2.0.1' ]] && [[ \$(version) == 2.0.1 ]] && systemctl is-active --quiet claudeweb"
check "the session still works after the web update" "token_ok \"\$token\""
check "the CLI agrees there is nothing newer" "claudeweb update | grep -q 'up to date'"
check "a malformed request is refused" "[[ \$(api -X POST -d '{\"version\":\"../x\"}' -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/claudeweb-update/update) == 400 ]]"

echo "== uninstall"
echo y | claudeweb uninstall > /tmp/cw-u9.out 2>&1
check "uninstall removes the update data" "[[ ! -e /var/lib/claudeweb-update && ! -e /opt/claudeweb ]]"

echo
if (( failures == 0 )); then echo "ALL PASS"; else echo "$failures FAILED"; fi
exit $(( failures > 0 ))
