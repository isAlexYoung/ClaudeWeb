#!/usr/bin/env bash
# ClaudeWeb installer. Run as root on a fresh Debian 12 (amd64) server:
#   bash <(curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh)
# Options:
#   --version=X.Y.Z   install that release (default: the latest stable one)
#   --package=FILE    install from a local release package instead of downloading
# The release list is verified with the minisign key below before anything
# from it is used.
# Running it again repairs an installation of the same version and never
# replaces the login password or user data.
set -euo pipefail

readonly OPT_DIR=/opt/claudeweb
readonly RELEASES="$OPT_DIR/releases"
readonly CURRENT="$OPT_DIR/current"
readonly ETC_DIR=/etc/claudeweb
readonly ENV_FILE="$ETC_DIR/claudeweb.env"
readonly INSTALL_RECORD="$ETC_DIR/install.json"
readonly DATA_DIR=/var/lib/claudeweb
readonly LOG_DIR=/var/log/claudeweb
readonly INSTALL_LOG="$LOG_DIR/install.log"
readonly SERVICE=claudeweb.service
readonly UNIT_FILE=/etc/systemd/system/claudeweb.service
readonly SERVICE_USER=claudeweb
readonly SERVICE_HOME=/home/claudeweb
readonly PORT=3001
readonly IPV6_SYSCTL=/etc/sysctl.d/90-claudeweb-disable-ipv6.conf
readonly MIN_MEMORY_MIB=1800   # a "2 GB" VPS reports a little less than 2048 MiB
readonly MIN_CPUS=2
readonly UPDATE_CONF="$ETC_DIR/update.conf"
readonly DEFAULT_RELEASES_URL=https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/releases
# The only key release lists are trusted under (minisign, key id 8D95EBD30103FEDD).
readonly RELEASE_PUBKEY=RWTd/gMB0+uVjUjFTKV/03UUGdQIoF+X+FIvGW8kdn9eDoqh3M2JMG39
# Where the signed list lives; overridable for testing with a mirror.
readonly RELEASES_URL="${CLAUDEWEB_RELEASES_URL:-$DEFAULT_RELEASES_URL}"

VERSION=""
PACKAGE=""
STAGE="starting"
WORK=""

REPORTED=0
say() { printf '%s\n' "$*"; }
step() { STAGE="$1"; say "==> $1"; }
fail() { say "" >&2; say "ClaudeWeb installation stopped: $*" >&2; REPORTED=1; exit 1; }
# One exit handler for every way out, including errors `set -e` and `set -u` stop at.
on_exit() {
  local status=$?
  [[ -n $WORK ]] && rm -rf "$WORK"
  if (( status != 0 && REPORTED == 0 )); then
    say "" >&2
    say "ClaudeWeb installation failed during: $STAGE (exit $status)." >&2
  fi
  if (( status != 0 )) && [[ -f $INSTALL_LOG ]]; then
    say "Details are in $INSTALL_LOG. Fix the problem and run the installer again; it continues safely." >&2
  fi
}
trap on_exit EXIT

for argument in "$@"; do
  case "$argument" in
    --version=*) VERSION="${argument#--version=}" ;;
    --package=*) PACKAGE="${argument#--package=}" ;;
    -h|--help) say "Usage: install.sh [--version=X.Y.Z] [--package=FILE]"; exit 0 ;;
    *) fail "unknown option $argument (see --help)" ;;
  esac
done

# ------------------------------------------------------------------ checks
step "Checking this server"
[[ $EUID -eq 0 ]] || fail "run the installer as root (for example: sudo bash install.sh)"
[[ "$(ps -p 1 -o comm= 2>/dev/null)" == systemd ]] || fail "systemd is required"
# Read in a subshell: /etc/os-release defines VERSION, which would replace --version.
os_id="$(. /etc/os-release && echo "${ID:-}")"
os_version="$(. /etc/os-release && echo "${VERSION_ID:-}")"
os_name="$(. /etc/os-release && echo "${PRETTY_NAME:-unknown}")"
[[ $os_id == debian && $os_version == 12 ]] || fail "only Debian 12 is supported for now (found $os_name)"
[[ "$(uname -m)" == x86_64 ]] || fail "only amd64 (x86_64) is supported for now (found $(uname -m))"
cpus="$(nproc)"
memory_mib="$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)"
(( cpus >= MIN_CPUS )) || fail "ClaudeWeb needs at least $MIN_CPUS CPU cores (found $cpus)"
(( memory_mib >= MIN_MEMORY_MIB )) || fail "ClaudeWeb needs at least 2 GB of memory (found ${memory_mib} MiB)"

mkdir -p "$LOG_DIR"
chmod 0750 "$LOG_DIR"
touch "$INSTALL_LOG"
chmod 0600 "$INSTALL_LOG"
# Everything goes to the terminal and the log, except the new password, which
# is written to fd 3 (the terminal only).
exec 3>&1
exec > >(tee -a "$INSTALL_LOG") 2>&1
say "$(date -u +%Y-%m-%dT%H:%M:%SZ) installer started with: $*"

installed_version=""
if [[ -f $INSTALL_RECORD && -f $CURRENT/VERSION ]]; then
  installed_version="$(cat "$CURRENT/VERSION")"
fi

# The port must be free, or held by ClaudeWeb itself (a repair).
if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet "$SERVICE"; then
  fail "port $PORT is already in use by another program (see: ss -ltnp 'sport = :$PORT')"
fi

# ------------------------------------------------------------------ system
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl git tar xz-utils procps util-linux iproute2 less jq minisign sudo
# The built-in browser's private display, window manager, clipboard, fonts and Chinese input.
apt-get install -y -q --no-install-recommends tigervnc-standalone-server openbox xauth x11-utils xdotool xclip \
  xfonts-base fonts-dejavu-core fonts-noto-cjk dbus dbus-x11 fcitx5 fcitx5-chinese-addons fcitx5-frontend-gtk3 fcitx5-frontend-qt5

# ------------------------------------------------------------------ package
step "Getting the release package"
WORK="$(mktemp -d)"
if [[ -z $PACKAGE ]]; then
  # The signed list decides what is installed: nothing in it is used unless
  # the signature checks out under RELEASE_PUBKEY.
  curl -fsSL --retry 3 -o "$WORK/releases.json" "$RELEASES_URL/releases.json" \
    || fail "cannot download the release list from $RELEASES_URL"
  curl -fsSL --retry 3 -o "$WORK/releases.json.minisig" "$RELEASES_URL/releases.json.minisig" \
    || fail "cannot download the release list signature"
  minisign -Vq -P "$RELEASE_PUBKEY" -m "$WORK/releases.json" -x "$WORK/releases.json.minisig" \
    || fail "the release list signature is not valid"
  if [[ -n $VERSION ]]; then
    entry="$(jq -c --arg v "$VERSION" '.releases[] | select(.version == $v)' "$WORK/releases.json")"
    [[ -n $entry ]] || fail "release $VERSION is not in the release list"
  else
    entry="$(jq -c '[.releases[] | select(.channel == "stable")] | sort_by(.version | split(".") | map(tonumber)) | last // empty' "$WORK/releases.json")"
    [[ -n $entry ]] || fail "no stable release is published yet; a test release can be installed with --version=X.Y.Z"
  fi
  say "Downloading ClaudeWeb $(jq -r .version <<<"$entry") ($(jq -r .channel <<<"$entry"))"
  PACKAGE="$WORK/$(jq -r .package.name <<<"$entry")"
  curl -fsSL --retry 3 -o "$PACKAGE" "$(jq -r .package.url <<<"$entry")" || fail "cannot download the package"
  [[ "$(stat -c %s "$PACKAGE")" == "$(jq -r .package.bytes <<<"$entry")" ]] || fail "the downloaded package has the wrong size"
  [[ "$(sha256sum "$PACKAGE" | cut -d' ' -f1)" == "$(jq -r .package.sha256 <<<"$entry")" ]] \
    || fail "the downloaded package does not match the release list"
else
  [[ -f $PACKAGE ]] || fail "package not found: $PACKAGE"
  if [[ -f $PACKAGE.sha256 ]]; then
    (cd "$(dirname "$PACKAGE")" && sha256sum -c --status "$(basename "$PACKAGE").sha256") || fail "the package does not match its .sha256 file"
  fi
fi
free_mib="$(df --output=avail -m "$(dirname "$OPT_DIR")" | tail -n1 | tr -d ' ')"
package_mib=$(( $(stat -c %s "$PACKAGE") / 1048576 + 1 ))
(( free_mib > package_mib * 6 + 2048 )) || fail "not enough free disk space (${free_mib} MiB free)"
tar -xJf "$PACKAGE" -C "$WORK"
unpacked="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'claudeweb-*' | head -n1)"
[[ -n $unpacked && -f $unpacked/VERSION && -x $unpacked/node/bin/node && -f $unpacked/app/dist-server/server/index.js ]] \
  || fail "this is not a ClaudeWeb release package"
package_version="$(cat "$unpacked/VERSION")"
[[ -z $VERSION || $VERSION == "$package_version" ]] || fail "--version=$VERSION does not match the package ($package_version)"
if [[ -n $installed_version && $installed_version != "$package_version" ]]; then
  fail "ClaudeWeb $installed_version is installed; update it with: claudeweb update"
fi
say "ClaudeWeb $package_version$( [[ -n $installed_version ]] && echo ' (repairing the existing installation)')"

step "Creating the claudeweb user and folders"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --create-home --home-dir "$SERVICE_HOME" --shell /bin/bash --comment ClaudeWeb "$SERVICE_USER"
fi
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$SERVICE_HOME"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$SERVICE_HOME/projects"
install -d -m 0755 -o root -g root "$OPT_DIR" "$RELEASES"
install -d -m 0750 -o root -g "$SERVICE_USER" "$ETC_DIR"
install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"

step "Installing ClaudeWeb $package_version"
target="$RELEASES/$package_version"
if [[ ! -d $target ]]; then
  chown -R root:root "$unpacked"
  mv "$unpacked" "$target.partial"
  mv "$target.partial" "$target"
fi
ln -sfn "$target" "$CURRENT.new"
mv -Tf "$CURRENT.new" "$CURRENT"
ln -sfn "$CURRENT/bin/claudeweb" /usr/local/bin/claudeweb

if [[ ! -f $ENV_FILE ]]; then
  cat > "$ENV_FILE" <<EOF
# ClaudeWeb settings, read by $SERVICE. Restart after changes: systemctl restart claudeweb
HOST=127.0.0.1
SERVER_PORT=$PORT
DATABASE_PATH=$DATA_DIR/auth.db
WORKSPACES_ROOT=$SERVICE_HOME
CLAUDE_CLI_PATH=$SERVICE_HOME/.local/bin/claude
CLAUDEWEB_BUNDLED_PLUGINS_DIR=$CURRENT/app/bundled-plugins
CLAUDEWEB_LOGIN_FILE=$ETC_DIR/login.json
CLAUDEWEB_PASSWORD_FILE=$ETC_DIR/password
EOF
fi
# Settings added after the first release are appended, never changed.
ensure_setting() { grep -q "^$1=" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"; }
ensure_setting CLAUDEWEB_UPDATE_SOCKET /run/claudeweb-update.sock
ensure_setting CLAUDEWEB_UPDATE_STATUS /run/claudeweb-update/status.json
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"
# `claudeweb update` reads the list from the same place this installer did.
printf '# Where `claudeweb update` finds the signed release list.\nRELEASES_URL=%s\n' "$RELEASES_URL" > "$UPDATE_CONF"
chmod 0644 "$UPDATE_CONF"

step "Installing the Claude Code CLI"
if [[ ! -x $SERVICE_HOME/.local/bin/claude ]]; then
  # Anthropic's official installer, run as the claudeweb user into its home.
  runuser -u "$SERVICE_USER" -- env -i HOME="$SERVICE_HOME" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" \
    PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 bash -c 'cd "$HOME" && curl -fsSL https://claude.ai/install.sh | bash' \
    || fail "the Claude Code CLI could not be installed; check the connection to claude.ai and run the installer again"
fi
[[ -x $SERVICE_HOME/.local/bin/claude ]] || fail "the Claude Code CLI was not found after installing it"

step "Installing the browser"
"$CURRENT/bin/claudeweb" install-browser \
  || say "The built-in browser could not be installed; everything else works. Retry later with: claudeweb install-browser"

step "Checking swap"
"$CURRENT/bin/claudeweb" swap --auto || say "Swap was not added; set it later with: claudeweb swap --size=2G"

step "Turning off IPv6"
# Done only when this session itself is not using IPv6, so the change cannot cut it off.
client="${SSH_CONNECTION:-}"
client="${client%% *}"
if [[ $client == *:* && $client != ::ffff:* ]]; then
  say "This SSH connection uses IPv6, so IPv6 was left on. Connect over IPv4 and run the installer again to turn it off."
elif ! ip -4 route show default | grep -q .; then
  say "No IPv4 default route found, so IPv6 was left on."
else
  cat > "$IPV6_SYSCTL" <<'EOF'
# Written by the ClaudeWeb installer: ClaudeWeb, its terminal and browser use IPv4 only.
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
EOF
  sysctl -q -p "$IPV6_SYSCTL" || say "IPv6 setting saved; it applies after the next reboot."
fi

step "Setting the login password"
new_password=""
if [[ ! -f $ETC_DIR/login.json ]]; then
  output="$("$CURRENT/bin/claudeweb" password --set)"
  new_password="$(sed -n 's/^New login password: //p' <<<"$output")"
fi

# Claude may use sudo, each time allowed in ClaudeWeb with this password; never without one.
step "Setting the sudo password"
new_sudo_password=""
if [[ ! -f $ETC_DIR/sudo-password ]]; then
  output="$("$CURRENT/bin/claudeweb" sudo-password --set)"
  new_sudo_password="$(sed -n 's/^New sudo password for [a-z]*: //p' <<<"$output")"
fi

step "Starting the service"
install -m 0644 "$CURRENT/share/claudeweb.service" "$UNIT_FILE"
# Settings > About asks root for updates through this socket.
install -m 0644 "$CURRENT/share/claudeweb-update.socket" /etc/systemd/system/claudeweb-update.socket
install -m 0644 "$CURRENT/share/claudeweb-update@.service" /etc/systemd/system/claudeweb-update@.service
systemctl daemon-reload
systemctl enable --now claudeweb-update.socket >/dev/null 2>&1
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
for _ in $(seq 1 120); do
  curl -fsS -m 3 "http://127.0.0.1:$PORT/api/auth/status" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS -m 3 "http://127.0.0.1:$PORT/api/auth/status" >/dev/null 2>&1 \
  || fail "ClaudeWeb did not start; see: claudeweb logs"

# A repair keeps the record, which also names the version `claudeweb rollback` returns to.
if [[ -z $installed_version ]]; then
  printf '{\n "version": "%s",\n "previous": null,\n "installed_at": "%s"\n}\n' "$package_version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$INSTALL_RECORD"
  chmod 0644 "$INSTALL_RECORD"
fi

step "Domain (optional)"
DOMAIN_STATE="$ETC_DIR/domain.json"
if [[ -f $DOMAIN_STATE && "$(jq -r '.phase // empty' "$DOMAIN_STATE")" == ready ]]; then
  install -m 0644 "$CURRENT/share/claudeweb-tunnel.service" /etc/systemd/system/claudeweb-tunnel.service
  systemctl daemon-reload
  say "Domain already set up: https://$(jq -r .hostname "$DOMAIN_STATE")"
elif [[ -r /dev/tty ]] && { : </dev/tty; } 2>/dev/null; then
  # Ctrl+C here only skips this step: the handler keeps the installer going.
  trap 'true' INT
  "$CURRENT/bin/claudeweb" domain --ask \
    || say "No domain was set up; ClaudeWeb works without one. Set it up later with: claudeweb domain"
  trap - INT
else
  say "No terminal to ask in; set up a domain later with: claudeweb domain"
fi

# Old release folders are kept for rollback; only the newest few stay.
{ ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +4 | grep -v "/$package_version/\$" | xargs -r rm -rf; } || true

STAGE="done"
server_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
say ""
say "ClaudeWeb $package_version is running."
say ""
if [[ -n $new_password ]]; then
  sleep 0.2   # let the log pipe finish the lines above before writing past it
  printf '  Login password:  %s\n' "$new_password" >&3
  echo "  Login password:  (shown on screen only, not saved in this log)" >> "$INSTALL_LOG"
  say "  (show it again with: claudeweb password)"
else
  say "  Login password:  unchanged (show it with: claudeweb password)"
fi
if [[ -n $new_sudo_password ]]; then
  printf '  sudo password:   %s\n' "$new_sudo_password" >&3
  echo "  sudo password:   (shown on screen only, not saved in this log)" >> "$INSTALL_LOG"
  say "  (type it in ClaudeWeb when Claude asks to use sudo; show it again with: claudeweb sudo-password)"
fi
say ""
if [[ -f $DOMAIN_STATE && "$(jq -r '.phase // empty' "$DOMAIN_STATE")" == ready ]]; then
  say "Open https://$(jq -r .hostname "$DOMAIN_STATE") on any device and sign in with the password above."
  say "ClaudeWeb itself only listens on this server (127.0.0.1:$PORT); an SSH tunnel works as well:"
else
  say "ClaudeWeb only listens on this server (127.0.0.1:$PORT). From your computer, open an SSH tunnel:"
fi
say "  ssh -L $PORT:127.0.0.1:$PORT root@${server_ip:-<this server>}"
say "then visit http://localhost:$PORT and sign in with the password above."
if [[ -f $DOMAIN_STATE && "$(jq -r '.phase // empty' "$DOMAIN_STATE")" == ready ]]; then
  say "CMCP can connect through the domain or over SSH."
else
  say "CMCP can also connect to it over SSH. Phones and tablets need a domain: claudeweb domain"
fi
say "Next: sign in to Claude in ClaudeWeb's terminal by running: claude"
say "Manage ClaudeWeb with: claudeweb help"
