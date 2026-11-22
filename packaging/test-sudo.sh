#!/usr/bin/env bash
# End-to-end sudo check on disposable Debian 12 / Ubuntu 22.04 amd64, as root:
#   bash packaging/test-sudo.sh /path/to/claudeweb-X.Y.Z-linux-x64.tar.xz
# Runs Claude's `sudo` shim as the claudeweb user, the way a command in a chat
# does, and answers through the web API the way the page does.
set -uo pipefail
PACKAGE="$1"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }
api() { curl -s -H "authorization: Bearer $token" -H 'content-type: application/json' "$@"; }
SOCKET=/home/claudeweb/.cache/claudeweb/sudo.sock
# What a chat command runs: the shim, as claudeweb, from its home, without a terminal.
shim() { (cd /home/claudeweb && runuser -u claudeweb -- env -i HOME=/home/claudeweb PATH=/usr/bin:/bin \
  CLAUDEWEB_SUDO_SOCKET="$SOCKET" CLAUDEWEB_NODE=/opt/claudeweb/current/node/bin/node \
  /opt/claudeweb/current/app/sudo-shim/sudo "$@" < /dev/null); }
next_request() {
  local id=""
  for _ in $(seq 1 50); do
    id="$(api http://127.0.0.1:3001/api/sudo/requests | jq -r '.requests[0].id // empty')"
    [[ -n $id ]] && break
    sleep 0.2
  done
  echo "$id"
}
answer() { api -o /dev/null -w '%{http_code}' -d "$2" "http://127.0.0.1:3001/api/sudo/requests/$1"; }

bash "$REPO/install.sh" --package="$PACKAGE" > /tmp/cw-s-install.out 2>&1
check "installer exits 0" "[[ $? -eq 0 ]]"
sudo_password="$(claudeweb sudo-password)"
check "the installer set a sudo password" "[[ \$sudo_password =~ ^[A-Za-z0-9]{20}$ ]]"
check "the installer printed it" "grep -qF -- \"sudo password:   \$sudo_password\" /tmp/cw-s-install.out"
check "it is not in the install log" "! grep -qF -- \"\$sudo_password\" /var/log/claudeweb/install.log"
check "the sudo password file is root-only" "[[ \$(stat -c '%U %a' /etc/claudeweb/sudo-password) == 'root 600' ]]"
check "claudeweb is in the sudo group" "id -nG claudeweb | tr ' ' '\n' | grep -qx sudo"
check "claudeweb has no password-free sudo" "! sudo -l -U claudeweb | grep -q NOPASSWD"
check "claudeweb cannot use sudo without the password" "! runuser -u claudeweb -- sudo -n true 2>/dev/null"
sshd -T > /tmp/cw-s-sshd.out 2>&1
check "the SSH configuration is still valid" "sshd -t"
check "SSH refuses claudeweb" "grep -qix 'denyusers claudeweb' /tmp/cw-s-sshd.out"
check "SSH still lets root in" "! grep -qi '^denyusers.*root' /tmp/cw-s-sshd.out"
check "the confirmation socket is private" "[[ \$(stat -c '%U %a' $SOCKET) == 'claudeweb 600' ]]"
password="$(claudeweb password)"
token="$(curl -s -H 'content-type: application/json' -d "{\"password\":\"$password\",\"mode\":\"takeover\"}" http://127.0.0.1:3001/api/auth/login | jq -r .token)"

echo "== allowed with the right password"
shim id -u > /tmp/cw-s1.out 2> /tmp/cw-s1.err &
pid=$!
id="$(next_request)"
check "the page sees the request with the exact command" "api http://127.0.0.1:3001/api/sudo/requests | jq -e '.requests[0].argv == [\"id\",\"-u\"] and .requests[0].cwd == \"/home/claudeweb\"' >/dev/null"
check "allowing is accepted" "[[ \$(answer \"\$id\" \"{\\\"approve\\\":true,\\\"password\\\":\\\"\$sudo_password\\\"}\") == 200 ]]"
wait "$pid"; status=$?
check "the command ran as root" "[[ $status -eq 0 && \$(cat /tmp/cw-s1.out) == 0 ]]"
check "the request is gone" "[[ \$(api http://127.0.0.1:3001/api/sudo/requests | jq '.requests | length') == 0 ]]"

echo "== a wrong password"
shim touch /root/cw-sudo-wrong > /tmp/cw-s2.out 2> /tmp/cw-s2.err &
pid=$!
id="$(next_request)"
answer "$id" '{"approve":true,"password":"not-the-password"}' > /dev/null
wait "$pid"; status=$?
check "a wrong password fails the command" "[[ $status -ne 0 ]] && grep -q 'password typed in ClaudeWeb was wrong' /tmp/cw-s2.err"
check "nothing ran" "[[ ! -e /root/cw-sudo-wrong ]]"

echo "== refused"
shim touch /root/cw-sudo-refused > /tmp/cw-s3.out 2> /tmp/cw-s3.err &
pid=$!
id="$(next_request)"
answer "$id" '{"approve":false}' > /dev/null
wait "$pid"; status=$?
check "a refusal fails the command" "[[ $status -eq 1 ]] && grep -q 'refused this command' /tmp/cw-s3.err && [[ ! -e /root/cw-sudo-refused ]]"

echo "== piped input"
(cd /home/claudeweb && printf 'hello from claude\n' | runuser -u claudeweb -- env -i HOME=/home/claudeweb PATH=/usr/bin:/bin \
  CLAUDEWEB_SUDO_SOCKET="$SOCKET" CLAUDEWEB_NODE=/opt/claudeweb/current/node/bin/node \
  /opt/claudeweb/current/app/sudo-shim/sudo tee /root/cw-sudo-piped > /dev/null) &
pid=$!
id="$(next_request)"
answer "$id" "{\"approve\":true,\"password\":\"$sudo_password\"}" > /dev/null
wait "$pid"
check "piped input reaches the command" "[[ \$(cat /root/cw-sudo-piped 2>/dev/null) == 'hello from claude' ]]"

echo "== a new sudo password"
claudeweb sudo-password --set > /tmp/cw-s-set.out 2>&1
new_sudo="$(claudeweb sudo-password)"
check "the password changed" "[[ -n \$new_sudo && \$new_sudo != \"\$sudo_password\" ]]"
shim true > /dev/null 2> /tmp/cw-s4.err &
pid=$!
id="$(next_request)"
answer "$id" "{\"approve\":true,\"password\":\"$sudo_password\"}" > /dev/null
wait "$pid"; status=$?
check "the old one no longer works" "[[ $status -ne 0 ]]"

journalctl -u claudeweb --no-pager > /tmp/cw-s-journal.out 2>&1
check "the service log has no sudo password" "! grep -qF -- \"\$sudo_password\" /tmp/cw-s-journal.out && ! grep -qF -- \"\$new_sudo\" /tmp/cw-s-journal.out"
rm -f /root/cw-sudo-piped

echo y | claudeweb uninstall > /dev/null 2>&1
check "uninstall removes the sudo password and its SSH rule" "[[ ! -e /etc/claudeweb/sudo-password && ! -e /etc/ssh/sshd_config.d/90-claudeweb.conf ]]"
echo
if (( failures == 0 )); then echo "ALL PASS"; else echo "$failures FAILED"; fi
exit $(( failures > 0 ))
