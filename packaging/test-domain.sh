#!/usr/bin/env bash
# `claudeweb domain` against a local stand-in for the Cloudflare API
# (test-domain-mock.py) and a fake cloudflared, on a server where ClaudeWeb is
# installed. As root on a disposable machine without a real cloudflared:
#   bash packaging/test-domain.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
failures=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }

TOKEN=test-api-token-0123456789abcdef
DOMAIN=example.test
ZONE=0123456789abcdef0123456789abcdef
ACCOUNT=fedcba9876543210fedcba9876543210
MOCK_PORT=18080
STATE=/tmp/cw-cf-state.json
OUT=/tmp/cw-domain.out
FAKE=/usr/bin/cloudflared

[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
[[ -x /opt/claudeweb/current/bin/claudeweb ]] || { echo "ClaudeWeb is not installed"; exit 1; }
[[ ! -e $FAKE ]] || { echo "$FAKE exists; this test only runs where it can put a fake one"; exit 1; }
[[ ! -e /etc/claudeweb/domain.json ]] || { echo "a domain is already set up here"; exit 1; }

rm -f "$STATE" "$STATE.fail-token"
python3 "$HERE/test-domain-mock.py" "$MOCK_PORT" "$STATE" "$TOKEN" "$DOMAIN" "$ZONE" "$ACCOUNT" &
mock=$!
cat > "$FAKE" <<'EOF'
#!/usr/bin/python3
# Fake cloudflared for packaging/test-domain.sh: reports a version, then serves /ready.
import http.server, sys
if '--version' in sys.argv:
    print('cloudflared version 2025.10.1 (fake, for the ClaudeWeb domain test)')
    sys.exit(0)
token = open(sys.argv[sys.argv.index('--token-file') + 1]).read()
if not token.startswith('run-token-for-'):
    sys.exit('unexpected run token')
class Ready(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == '/ready' else 404)
        self.end_headers()
    def log_message(self, *args):
        pass
http.server.HTTPServer(('127.0.0.1', 20241), Ready).serve_forever()
EOF
chmod 0755 "$FAKE"
cleanup() {
  kill "$mock" 2>/dev/null
  claudeweb domain --remove --local >/dev/null 2>&1
  rm -f "$FAKE" "$STATE" "$STATE.tmp" "$STATE.fail-token" "$OUT" /tmp/cw-domain-status.out
}
trap cleanup EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$MOCK_PORT/" && break; sleep 0.1; done

export CLAUDEWEB_CF_API="http://127.0.0.1:$MOCK_PORT/client/v4"
export CLAUDEWEB_DOMAIN_PROBE=http://127.0.0.1:3001
# run <answers> <command>: the command in a pseudo-terminal; each answer is typed after its prompt.
run() { python3 "$HERE/test-pty.py" "$(printf '%b' "$1")" "$2" > "$OUT" 2>&1; }
mock() { jq -r "$1" "$STATE"; }
state() { jq -r ".$1 // empty" /etc/claudeweb/domain.json 2>/dev/null; }

check "status says there is no domain" "claudeweb domain --status | grep -q 'No domain'"

run "$DOMAIN\nother.test\n" "claudeweb domain"
check "two different domain entries are refused" "[[ $? -ne 0 ]] && grep -q 'entries differ' $OUT && [[ ! -e /etc/claudeweb/domain.json ]]"

run "wrong.test\nwrong.test\n\n$ACCOUNT\n$ZONE\n$TOKEN\n" "claudeweb domain"
check "a Zone ID of another domain is refused" "[[ $? -ne 0 ]] && grep -q 'not wrong.test' $OUT && [[ ! -e /etc/claudeweb/domain.json ]]"

run "$DOMAIN\n$DOMAIN\n\n$ACCOUNT\n$ZONE\nwrong-token-0123456789abcdef\n" "claudeweb domain"
check "a wrong API token is refused" "[[ $? -ne 0 ]] && grep -q 'Authentication error' $OUT && [[ ! -e /etc/claudeweb/domain.json ]]"

# A random name under the domain.
run "$DOMAIN\n$DOMAIN\n\n$ACCOUNT\n$ZONE\n$TOKEN\n" "claudeweb domain"
check "setup with a random name exits 0" "[[ $? -eq 0 ]]"
host="$(state hostname)"; tunnel="$(state tunnel_id)"; name="$(state tunnel_name)"
check "the name is random, one level under the domain" "[[ $host =~ ^[0-9a-f]{20}\\.example\\.test$ ]]"
check "the setup is marked ready" "[[ $(state phase) == ready ]]"
check "the tunnel service runs" "systemctl is-active --quiet claudeweb-tunnel"
records="$(mock '[.dns[]] | length')"
record="$(mock '[.dns[]][0] | "\(.type) \(.name) \(.content) \(.proxied) \(.comment)"')"
check "Cloudflare has one proxied CNAME to the tunnel, marked as ClaudeWeb's" \
  "[[ \$records == 1 && \$record == 'CNAME $host $tunnel.cfargotunnel.com true claudeweb-managed:$name' ]]"
routes="$(mock ".configs[\"$tunnel\"].config.ingress | map(.hostname // .service) | join(\" \")")"
target="$(mock ".configs[\"$tunnel\"].config.ingress[0].service")"
check "the tunnel routes only that name, to ClaudeWeb" "[[ \$routes == '$host http_status:404' && \$target == http://127.0.0.1:3001 ]]"
check "the run token is stored for root only" "[[ \$(stat -c '%U %a' /etc/claudeweb/tunnel-token) == 'root 600' && \$(cat /etc/claudeweb/tunnel-token) == run-token-for-$tunnel ]]"
check "the API token was not shown on screen or stored anywhere" \
  "! grep -rqs -- '$TOKEN' /etc/claudeweb /var/lib/claudeweb /var/log/claudeweb $OUT && ! journalctl -q --no-pager -u claudeweb-tunnel | grep -q -- '$TOKEN'"
claudeweb status > /tmp/cw-domain-status.out 2>&1
check "claudeweb status shows the domain" "grep -qF 'Domain:    https://$host (tunnel active)' /tmp/cw-domain-status.out"
run "" "claudeweb domain"
check "running it again only says it is set up" "[[ $? -eq 0 ]] && grep -q 'already set up: https://$host' $OUT"

run "$TOKEN\n" "claudeweb domain --remove"
check "remove exits 0" "[[ $? -eq 0 ]]"
check "remove deleted the DNS record and the tunnel in Cloudflare" "[[ \$(mock '[.dns[]] | length') == 0 && \$(mock '[.tunnels[]] | length') == 0 ]]"
check "remove stopped and forgot the tunnel here" \
  "! systemctl is-active --quiet claudeweb-tunnel && [[ ! -e /etc/claudeweb/domain.json && ! -e /etc/claudeweb/tunnel-token && ! -e /etc/systemd/system/claudeweb-tunnel.service ]]"

# A chosen name; the run token request fails once, so the setup stops half way.
touch "$STATE.fail-token"
run "$DOMAIN\n$DOMAIN\nn\nclaude.$DOMAIN\n$ACCOUNT\n$ZONE\n$TOKEN\n" "claudeweb domain"
check "a failure half way stops the setup and records how far it got" "[[ $? -ne 0 && $(state phase) == dns && $(state hostname) == claude.$DOMAIN ]]"
run "\n$TOKEN\n" "claudeweb domain"
check "the unfinished setup continues and finishes" "[[ $? -eq 0 && $(state phase) == ready ]] && grep -q 'unfinished domain setup for claude.$DOMAIN' $OUT"
check "continuing created nothing twice" "[[ \$(mock '[.dns[]] | length') == 1 && \$(mock '[.tunnels[]] | length') == 1 ]]"

claudeweb domain --remove --local > "$OUT" 2>&1
check "remove --local forgets the tunnel here and leaves Cloudflare alone" \
  "[[ ! -e /etc/claudeweb/domain.json ]] && [[ \$(mock '[.tunnels[]] | length') == 1 ]] && grep -q 'delete the tunnel' $OUT"

run "$DOMAIN\n$DOMAIN\nn\nclaude.$DOMAIN\n$ACCOUNT\n$ZONE\n$TOKEN\n" "claudeweb domain"
check "a name whose DNS record exists is refused before anything is created" \
  "[[ $? -ne 0 ]] && grep -q 'already exists' $OUT && [[ ! -e /etc/claudeweb/domain.json ]] && [[ \$(mock '[.tunnels[]] | length') == 1 ]]"

touch "$STATE.fail-token"
run "$DOMAIN\n$DOMAIN\nn\nother.$DOMAIN\n$ACCOUNT\n$ZONE\n$TOKEN\n" "claudeweb domain"
check "a second setup stops half way" "[[ $? -ne 0 && $(state phase) == dns ]]"
run "n\n$TOKEN\n$DOMAIN\nstop.test\n" "claudeweb domain"
check "declining to continue deletes what it created in Cloudflare and forgets it" \
  "[[ ! -e /etc/claudeweb/domain.json ]] && [[ \$(mock '[.dns[] | select(.name == \"other.$DOMAIN\")] | length') == 0 && \$(mock '[.tunnels[]] | length') == 1 ]]"

echo
if (( failures == 0 )); then echo "ALL PASS"; else echo "$failures FAILED"; fi
exit $(( failures > 0 ))
