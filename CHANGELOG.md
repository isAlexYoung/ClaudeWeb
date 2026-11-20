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
