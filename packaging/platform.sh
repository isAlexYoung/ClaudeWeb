# Shared installer/management platform rules. Embedded by sync-platform.py so
# the public one-line installer never sources another unverified download.
cw_platform_select() {
  CW_PLATFORM=""
  CW_BASE_PACKAGES=(ca-certificates curl git tar xz-utils procps util-linux iproute2 less jq sudo)
  CW_GUI_PACKAGES=(tigervnc-standalone-server openbox xauth x11-utils xdotool xclip
    xfonts-base fonts-dejavu-core fonts-noto-cjk dbus dbus-x11 fcitx5
    fcitx5-chinese-addons fcitx5-frontend-gtk3 fcitx5-frontend-qt5)
  CW_DESKTOP_PACKAGES=(gnupg gnome-keyring libsecret-1-0)
  [[ $3 == x86_64 ]] || { echo "only amd64 (x86_64) is supported (found $3)" >&2; return 1; }
  case "$1:$2" in
    debian:12) CW_PLATFORM=debian-12; CW_BASE_PACKAGES+=(minisign) ;;
    ubuntu:22.04) CW_PLATFORM=ubuntu-22.04 ;;
    *) echo "only Debian 12 and Ubuntu 22.04 LTS are enabled (found ${1:-unknown} ${2:-unknown})" >&2; return 1 ;;
  esac
}

cw_platform_detect() {
  local release_file="${1:-/etc/os-release}" os_id os_version
  [[ -r $release_file ]] || { echo "cannot read $release_file" >&2; return 1; }
  # Keep VERSION, ID and other os-release variables out of the caller's scope.
  os_id="$(. "$release_file"; printf '%s' "${ID:-}")"
  os_version="$(. "$release_file"; printf '%s' "${VERSION_ID:-}")"
  cw_platform_select "$os_id" "$os_version" "$(uname -m)"
}

cw_prepare_apt() {
  apt-get -o DPkg::Lock::Timeout=180 update -q || return
  if [[ $CW_PLATFORM == ubuntu-22.04 ]] && ! LC_ALL=C apt-cache policy tigervnc-standalone-server \
    | awk '$1 == "Candidate:" && $2 != "(none)" { found=1 } END { exit !found }'; then
    # Respect the server's selected mirrors and signing keys. The distro tool
    # adds Universe to its configured sources; do not replace sources.list.
    apt-get -o DPkg::Lock::Timeout=180 install -y -q --no-install-recommends software-properties-common || return
    add-apt-repository -y universe || return
    apt-get -o DPkg::Lock::Timeout=180 update -q || return
  fi
}

cw_minisign() {
  # The root update socket deliberately has a small PATH. Resolve the pinned
  # Jammy bootstrap without expanding that service's executable search path.
  if [[ -x /usr/bin/minisign ]]; then /usr/bin/minisign "$@";
  elif [[ -x /usr/local/bin/minisign ]]; then /usr/local/bin/minisign "$@";
  else echo 'minisign is missing; repair the ClaudeWeb installation' >&2; return 1; fi
}

cw_ensure_minisign() (
  cw_minisign -v >/dev/null 2>&1 && exit 0
  [[ $CW_PLATFORM == ubuntu-22.04 ]] || { echo 'minisign was not installed by APT' >&2; exit 1; }
  # Ubuntu 22.04 has no minisign executable in its archive. Pin the upstream
  # static release and digest here, before trusting any ClaudeWeb release list.
  local work destination=/usr/local/bin/minisign
  work="$(mktemp -d)" || exit
  trap 'rm -rf -- "$work"' EXIT
  curl -fsSL --retry 3 -o "$work/minisign.tar.gz" \
    https://github.com/jedisct1/minisign/releases/download/0.12/minisign-0.12-linux.tar.gz || exit
  printf '%s  %s\n' 9a599b48ba6eb7b1e80f12f36b94ceca7c00b7a5173c95c3efc88d9822957e73 "$work/minisign.tar.gz" \
    | sha256sum -c --status || { echo 'minisign bootstrap checksum mismatch; nothing was installed' >&2; exit 1; }
  tar -xzf "$work/minisign.tar.gz" -C "$work" minisign-linux/x86_64/minisign || exit
  [[ ! -e $destination && ! -L $destination ]] || { echo "refusing to replace $destination" >&2; exit 1; }
  install -d -m 0755 /usr/local/bin || exit
  install -m 0755 -o root -g root "$work/minisign-linux/x86_64/minisign" "$destination" || exit
  "$destination" -v
)

cw_install_dependencies() {
  local mode=$1
  cw_platform_detect || return
  export DEBIAN_FRONTEND=noninteractive
  cw_prepare_apt || return
  case "$mode" in
    base-gui)
      apt-get -o DPkg::Lock::Timeout=180 install -y -q --no-install-recommends "${CW_BASE_PACKAGES[@]}" "${CW_GUI_PACKAGES[@]}" || return
      cw_ensure_minisign || return ;;
    gui)
      apt-get -o DPkg::Lock::Timeout=180 install -y -q --no-install-recommends "${CW_GUI_PACKAGES[@]}" || return ;;
    desktop)
      apt-get -o DPkg::Lock::Timeout=180 install -y -q --no-install-recommends ca-certificates curl "${CW_GUI_PACKAGES[@]}" "${CW_DESKTOP_PACKAGES[@]}" || return ;;
    *) echo "unknown dependency group: $mode" >&2; return 1 ;;
  esac
}

cw_check_release_platform() {
  local release=$1
  jq -e --arg platform "$CW_PLATFORM" '
    if has("platforms") then
      (.platforms | type == "array") and (.platforms | index($platform) != null)
    else
      .os == "debian-12" and $platform == "debian-12"
    end' "$release/release.json" >/dev/null \
    || { echo "this release package does not target $CW_PLATFORM; use a compatible ClaudeWeb package" >&2; return 1; }
  if [[ -f $release/share/check-runtime.cjs ]]; then
    "$release/node/bin/node" "$release/share/check-runtime.cjs" "$release/app" || return
  fi
}
