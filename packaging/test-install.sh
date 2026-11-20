#!/usr/bin/env bash
# End-to-end installer check on a disposable Debian 12 machine (WSL or VM), as root:
#   bash packaging/test-install.sh /path/to/claudeweb-X.Y.Z-linux-x64.tar.xz
# Installs, signs in, re-runs the installer, exercises `claudeweb`, uninstalls.
# Prints PASS/FAIL per step and never prints the login password.
set -uo pipefail
PACKAGE="$1"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }
login() { curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  -d "{\"password\":\"$1\"}" http://127.0.0.1:3001/api/auth/login; }

echo "== install"
bash "$REPO/install.sh" --package="$PACKAGE" > /tmp/cw-install.out 2>&1
status=$?
check "installer exits 0" "[[ $status -eq 0 ]]"
[[ $status -eq 0 ]] || tail -n 40 /tmp/cw-install.out
password="$(sed -n 's/^  Login password:  //p' /tmp/cw-install.out | head -n1)"
check "installer prints a password" "[[ \$password =~ ^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$ ]]"
[[ -n $password ]] || password="no-password-was-printed"
check "password is not in the install log" "! grep -qF -- \"\$password\" /var/log/claudeweb/install.log"
check "service is active" "systemctl is-active --quiet claudeweb"
echo "listening: $(ss -ltnH 'sport = :3001' | awk '{print $4}' | tr '\n' ' ')"
check "listens on 127.0.0.1:3001 only" "[[ \$(ss -ltnH 'sport = :3001' | awk '{print \$4}' | sort -u | tr -d '\n') == '127.0.0.1:3001' ]]"
check "runs as claudeweb" "[[ \$(ps -o user= -p \$(systemctl show -p MainPID --value claudeweb)) == claudeweb ]]"
check "claudeweb password shows the same password" "[[ \$(claudeweb password) == \"\$password\" ]]"
check "password file is root-only" "[[ \$(stat -c '%U %a' /etc/claudeweb/password) == 'root 600' ]]"
check "login.json readable by the service group only" "[[ \$(stat -c '%U:%G %a' /etc/claudeweb/login.json) == 'root:claudeweb 640' ]]"
check "the service user cannot read the password" "! runuser -u claudeweb -- cat /etc/claudeweb/password >/dev/null 2>&1"
check "the web page loads" "curl -fsS http://127.0.0.1:3001/ | grep -qi '<div id=\"root\"'"
check "right password signs in" "[[ \$(login \"\$password\") == 200 ]]"
check "wrong password is refused" "[[ \$(login wrong-password-1) == 401 ]]"
check "Claude CLI installed for claudeweb" "runuser -u claudeweb -- /home/claudeweb/.local/bin/claude --version >/dev/null 2>&1"
check "IPv6 turned off" "[[ \$(sysctl -n net.ipv6.conf.all.disable_ipv6) == 1 ]]"
check "claudeweb status works" "claudeweb status >/tmp/cw-status.out 2>&1 && grep -q answering /tmp/cw-status.out"
check "claudeweb doctor has no password" "claudeweb doctor >/tmp/cw-doctor.out 2>&1; ! grep -qF -- \"\$password\" /tmp/cw-doctor.out"
check "claudeweb help lists uninstall" "claudeweb help | grep -q -- '--delete-projects'"
check "unknown command shows help and fails" "! claudeweb nonsense >/tmp/cw-unknown.out 2>&1 && grep -q 'Commands:' /tmp/cw-unknown.out"

echo "== repair (run the installer again)"
mkdir -p /home/claudeweb/projects/demo && echo keep > /home/claudeweb/projects/demo/file.txt
chown -R claudeweb:claudeweb /home/claudeweb/projects/demo
bash "$REPO/install.sh" --package="$PACKAGE" > /tmp/cw-install2.out 2>&1
check "second run exits 0" "[[ $? -eq 0 ]]"
check "second run keeps the password" "[[ \$(claudeweb password) == \"\$password\" ]] && grep -q 'unchanged' /tmp/cw-install2.out"
check "service still answers" "[[ \$(login \"\$password\") == 200 ]]"

echo "== password --set"
claudeweb password --set > /tmp/cw-set.out 2>&1
new_password="$(sed -n 's/^New login password: //p' /tmp/cw-set.out)"
check "new password differs" "[[ -n \$new_password && \$new_password != \"\$password\" ]]"
check "old password stops working" "[[ \$(login \"\$password\") == 401 ]]"
check "new password works" "[[ \$(login \"\$new_password\") == 200 ]]"

echo "== uninstall"
echo n | claudeweb uninstall > /tmp/cw-un-n.out 2>&1
check "answering n changes nothing" "systemctl is-active --quiet claudeweb && grep -q 'nothing was changed' /tmp/cw-un-n.out"
echo y | claudeweb uninstall > /tmp/cw-un-y.out 2>&1
check "answering y removes the service" "! systemctl is-active --quiet claudeweb && [[ ! -e /etc/systemd/system/claudeweb.service ]]"
check "program, settings and data are gone" "[[ ! -e /opt/claudeweb && ! -e /etc/claudeweb && ! -e /var/lib/claudeweb && ! -e /usr/local/bin/claudeweb ]]"
check "the claudeweb user is gone" "! id claudeweb >/dev/null 2>&1"
check "projects are kept" "[[ \$(cat /home/claudeweb/projects/demo/file.txt) == keep ]]"
check "the rest of the home is gone" "[[ ! -e /home/claudeweb/.local ]]"

echo
if (( failures == 0 )); then echo "ALL PASS"; else echo "$failures FAILED"; fi
exit $(( failures > 0 ))
