# Changelog

All notable changes to ClaudeWeb are listed here. Versions start at 2.0.0;
2.0.0 to 2.0.3 were test releases and 2.1.0 is the first stable release.

## Unreleased

## 2.1.1 - 2026-11-22 (stable)

### Changed

- Place a smaller 24 px repository logo before the sidebar controls and in the
  collapsed rail. Clicking it opens the ClaudeWeb repository. Refresh browser
  icon URLs so older favicons are replaced.
- Simplify Plugins settings to custom repository installation and installed
  plugin controls. Add an original custom-plugin guide; remove the catalog and
  starter-template links. Use Plug and the MessageCircle chat bubble for Plugins
  and Tasks & sessions.
- Remove Git settings and its unused identity APIs/adapters. Existing database
  values and project Git features are retained; identity can be set with Git CLI.
- Center the bilingual README headers with badges and navigation. Keep public
  documentation focused on usage; remove development plans and validation logs.
- Remove stale CloudCLI marketing and plugin-catalog references while keeping
  upstream attribution, third-party provenance and legacy-backup compatibility.

## 2.1.0 - 2026-11-22 (stable)

The first stable release, for amd64 servers running Debian 12, Debian 13,
Ubuntu 22.04, Ubuntu 24.04 or Ubuntu 26.04, each accepted on a real VPS.
The default one-line install and Settings > About now offer it.

### Added

- The ClaudeWeb logo: a chat-bubble C around a folded, raised W in white on
  Claude-style orange. It is the browser tab icon, the home-screen icon
  (192 and 512 px, Apple touch icon) and the mark on the login page.

### Changed

- Hide composer model/effort and permission menu scrollbars while retaining
  scrolling. Disable the model/effort control until Claude CLI is signed in,
  rechecking login when the page regains focus and while it remains visible.
  Animate Side chat and Memory with the same disclosure used by Context and Connectors.
- Default the workspace account label and named home greetings to `User`,
  preserving custom profile names. Remove the API and tokens settings page
  from desktop/mobile navigation and fall back to General for old links to it.
- Add Debian 13 amd64 to the shared platform rules, release metadata and VM
  matrix, using Debian's minisign and ALSA t64 packages. Preserve Debian's
  graphical sandbox policy and use the existing disk-backed staging and
  `/etc/sysctl.d` configuration. Older packages remain refused on Debian 13.
  Accepted on a real Debian 13 VPS.
- Add Ubuntu 26.04 LTS amd64 admission, metadata and VM checks alongside
  24.04. Keep large installer/update staging under
  `/var/tmp` so Resolute's default `/tmp` tmpfs does not hold release archives.
  sudo-rs, Rust coreutils and the graphical policies were checked on a real
  Ubuntu 26.04 VPS.
- Start the loopback web service and retrying tunnel after `network.target`
  without pulling in `network-online.target`. VPS images whose interfaces are
  managed outside systemd-networkd no longer block ClaudeWeb installation while
  its unrelated wait-online service waits.
- Recognize sudo-rs authentication failures, including messages split across
  pipe chunks, so an incorrect password gets the existing wrong-password hint.
- Poll graphical window readiness so class/visibility changes after mapping
  are observed. Lifecycle acceptance checks retain the main application and
  displays, allowing transient renderer/GPU helpers to exit normally.
- Add Ubuntu 24.04 LTS amd64 to the shared installer and package platform rules,
  using the distro's minisign and ALSA t64 package. Keep the Ubuntu 22.04 glibc
  2.35 build baseline and refuse older packages that do not declare Noble.
- Prepare an application-specific AppArmor user-namespace profile for Playwright
  Chromium on Noble, preserving official ClaudeDesktop's own profile. Install,
  repair and update load it without disabling global restrictions or browser sandboxes;
  uninstall removes only ClaudeWeb-managed policy. Existing administrator policy
  and unsafe symlinks are left unchanged with an actionable error.
- Add pinned Ubuntu 24.04 VM targets, AppArmor policy checks and actual Desktop
  lifecycle checks to the Noble browser test.

## 2.0.3 - 2026-11-22 (test release)

### Fixed

- Creating swap works with Ubuntu 22.04's util-linux: silence `mkswap` output
  without its unavailable `-q` option. VM installation checks now verify active
  swap, including installations through the published one-line command.

### Changed

- Installers and repair commands accept Ubuntu 22.04 LTS amd64 as
  well as Debian 12. Platform dependencies are maintained in one shared source;
  Ubuntu enables Universe when needed and bootstraps the missing minisign tool
  from a fixed upstream release with a pinned SHA-256.
- Release packages build their native modules on Ubuntu 22.04 for a common
  glibc 2.35 baseline. Installation and updating check the package's declared
  platforms and load SQLite, bcrypt and a PTY before replacing the running
  version. Existing Debian-only releases are refused on Ubuntu. Settings shows
  a localized explanation when an incompatible package leaves the old version
  running, including after reopening Settings. Redirected installations skip
  the optional domain prompt instead of waiting for invisible terminal input.
- Packaging CI includes Debian 12 and Ubuntu 22.04 VM targets. Real Ubuntu VPS
  acceptance and account sign-in remain separate checks; this is a test release.
- The one-line installer shows 15 numbered stages instead of streaming package
  download output. Detailed command output stays in the private installation
  log; failures show a short error excerpt and its path. Domain prompts and
  final passwords remain visible, with passwords excluded from the log.
- Successful installation ends with a `welcome to` / `CLAUDEWEB` ASCII banner,
  using a compact title on narrow terminals. The large lettering uses the
  reference pale orange (#E0B09D) on its upper three rows and white on its
  lower two rows. ANSI colors appear only in an interactive terminal; logs
  and redirected output stay plain text.

### Added

- ClaudeDesktop opens from the asterisk beside Terminal in a fixed modal with
  full-screen, minimize and close controls. Minimize keeps the app alive;
  close ends its private process groups and removes runtime files and
  regenerable Electron caches, preserving sign-in, configuration and keyrings.
  Closing during startup cancels the window waiter; normal server shutdown also
  reclaims its graphical sessions.
- Minimized terminal, browser and ClaudeDesktop tools show an orange dot on
  their header icons. Restoring keeps the same running session.
- `claudeweb install-desktop` installs the official signed APT package and its
  graphical/keyring dependencies. Fresh installs and updates attempt to install
  Desktop when absent. No stable release is published.

## 2.0.2 - 2026-11-21 (test release)

### Added

- Domains: `claudeweb domain` (also offered at the end of the installation)
  gives ClaudeWeb an HTTPS address under a Cloudflare-managed domain through a
  Cloudflare Tunnel, without opening a port. It asks for the domain (twice), a
  random or chosen name one level under it, the Account ID, the Zone ID and a
  hidden API token that is never stored; creates the tunnel, its route to
  ClaudeWeb and a proxied DNS record; installs cloudflared from Cloudflare's
  signed package source (key pinned); and reports the address only when the
  tunnel is connected, the page answers and an API without a login is
  refused. An interrupted setup continues or is cleaned up on the next run.
  `claudeweb domain --status`, `--remove` and `--remove --local`;
  `claudeweb status` shows the domain. Tested against a local stand-in for the
  Cloudflare API (`packaging/test-domain.sh`), not yet against Cloudflare.
- Moving from WebDesktop: a backup made in another home folder (WebDesktop's
  ClaudeWeb ran in `/home/wdguest`) is restored under this one. Transcript
  folders, every `cwd` in the transcripts and the project paths of the
  restored rows move to `/home/claudeweb`, so the conversations continue in
  the new place; paths outside the old home stay as they are. The import
  preview says so.
- Backups can include project folders: Settings > Backup & restore lists the
  projects inside the home folder to choose from. They are stored under
  `files/` with their Git history and permissions (no links, no set-id
  bits); an import restores them under the home folder, never into its
  hidden folders and never over an existing file.
- Backups include Claude's user settings: settings.json (its `env` entries
  whose names mention a key, token, secret, password, credential or auth are
  left out), CLAUDE.md, and the commands, agents, skills and output-styles
  folders; never the sign-in or `.claude.json`. The import lists them as one
  entry that can be left out, keeps files that exist, and moves paths under
  the old home folder in settings.json to the new one.
- Backups list the plugins installed from a repository (name, source,
  enabled), never their code or keys. After an import, Settings > Backup &
  restore lists the ones this server lacks with an Install button that puts
  each back from its source.
- The update confirmation in Settings > About says how many conversations
  (scheduled tasks included) the restart would stop.

## 2.0.1 - 2026-11-21 (test release)

### Fixed

- Settings showed "TaskMaster AI CLI is not installed" after signing in on
  the login page (or through CMCP), although the bundled TaskMaster works.
  The check ran before sign-in, was refused, and was not repeated; it now
  runs once the session is signed in.
- The README's install command runs as root without `sudo` (Debian has no
  `sudo` until ClaudeWeb installs it).

### Added

- The **Check a published release** workflow can install one published
  release and update it to another (`from` input), the way a server is
  updated with `claudeweb update --version=X.Y.Z`.

## 2.0.0 - 2026-11-21 (test release)

### Added

- One login password per server, set by root: `claudeweb password` shows it,
  `claudeweb password --set` replaces it with a generated one (`--stdin` for
  your own). The web page asks only for the password; there is no sign-up.
- Failed passwords lock the visitor's IP: 1 minute after 5 tries, then
  5 minutes, then 30 minutes. The page shows the time left.
- Sessions are kept on the server: signing out ends only that device, and a
  new password signs out every device.

- `install.sh` installs ClaudeWeb from a release package on Debian 12 amd64:
  the `claudeweb` user, its folders, the official Claude Code CLI, swap when
  the machine has none, IPv6 turned off, a generated login password, and the
  `claudeweb` service on 127.0.0.1:3001. Running it again repairs the install
  and keeps the password and data.
- The `claudeweb` command for root: `help`, `status`, `logs`, `doctor`,
  `password`, `swap`, `uninstall` (projects are kept unless
  `--delete-projects`).
- `packaging/build-release.sh` builds the release package, with its own
  Node.js 22.
- Signed releases: `install.sh` installs the latest stable release from a
  list signed with ClaudeWeb's minisign key (`--version` for test releases).
- `claudeweb update` and Settings > About update to the latest stable
  release: download checked against the list, database copied, automatic
  return to the previous version when the new one does not start.
  `claudeweb rollback` returns to the previous version from any state.

- The browser panel runs Playwright's Chromium on the server, on a private
  display (Xvnc) with Openbox, Chinese fonts and Fcitx 5 Pinyin input. Text
  and PNG clipboard on request; another device takes the browser over; it
  is kept ten minutes after a dropped connection. `claudeweb
  install-browser` installs or repairs it; updates install a newly pinned
  Chromium.

- Up to three devices can be signed in. A new login while another device is
  signed in asks whether to join or take over (sign the others out); when
  three are signed in it asks which one to sign out. Settings > About lists
  the signed-in devices and can sign one out; the others see a notice when
  a new device joins. Web logins end after an hour without use. The oldest
  login is the main device and is the only one that can start an update.
  Connections of a signed-out device close within 15 seconds.
  Scripts calling `POST /api/auth/login` should send `"mode": "join"` or
  `"takeover"`.
- CMCP sign-in (CMCP 4.24.0 and later): `GET /api/auth/cmcp` names the
  protocol `claudeweb-cmcp`; CMCP trades the saved password for a one-time
  code (`POST /api/auth/cmcp/code`, two minutes, under the same IP lockout)
  and opens the page at `/#cmcp=<code>`, which signs itself in through
  `POST /api/auth/cmcp/redeem` with the same join / take over question.
  CMCP logins are listed as CMCP and do not end after an idle hour. Older
  CMCP releases open the page with the normal password form.
- sudo for Claude, allowed each time in ClaudeWeb: a `sudo` in a chat's
  command shows the exact command and folder on every signed-in page;
  typing the sudo password and choosing Allow runs it once through
  `sudo -S -k`, Refuse or five minutes without an answer fails it. The
  password goes only to sudo: not to Claude, the logs or the browser's
  storage. The installer puts the claudeweb user in the sudo group with a
  generated password (never password-free sudo), shows it once, and keeps
  that user out of SSH (DenyUsers); `claudeweb sudo-password` shows or
  changes it. In the terminal, sudo asks for the password as usual.
- A tool call of Claude's that names the user's sensitive information asks
  first, even when tool approvals are off: Claude's login credentials, the
  built-in browser's cookies and sign-in data, ClaudeWeb's database and
  settings, and a release signing key. The card says "This is the user's
  sensitive information" and what the call would reach; Allow this once
  or Refuse. Unattended runs refuse. Only calls that name these files are
  caught (file tools, searches, command lines); one list in
  server/modules/sensitive-access.
- Out of memory, Linux ends what ClaudeWeb started (Claude, terminals, the
  browser) before ClaudeWeb itself: the service runs with
  OOMScoreAdjust=-100 and raises everything below it to 500 every few
  seconds; sshd is not outranked.

### Changed

- ClaudeWeb is now a standalone project, independent of WebDesktop. The
  application started from the ClaudeWeb 1.0.17 code.
- Names, data folder (`~/.claudeweb`), environment variables
  (`CLAUDEWEB_*`) and the package name changed from CloudCLI to ClaudeWeb.
  Backups made by earlier releases still restore.
- The server listens on `127.0.0.1` unless `HOST` says otherwise.
- The app's `update` command no longer installs from npm; updates go through
  the root command `claudeweb update`.

### Removed

- The hosted "platform mode", which trusted every request as the first user.
  ClaudeWeb now checks every request itself.
- Upstream-only parts: Docker sandbox command, desktop app, npm publishing,
  the Pro upsell card.
