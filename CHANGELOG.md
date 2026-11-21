# Changelog

All notable changes to ClaudeWeb are listed here. Versions start at 2.0.0,
the first standalone release; everything published before the 2.0.0 stable
release is a test release.

## Unreleased

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
