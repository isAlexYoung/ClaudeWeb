<div align="center">

<img src="app/public/logo-256.png" width="112" height="112" alt="ClaudeWeb logo" />

# ClaudeWeb

### Use Claude Code on your own server, from a browser

**Keep chats, projects, files, a terminal, a browser and ClaudeDesktop in one web interface, running on your Linux server with the official Claude CLI.**

[![Version](https://img.shields.io/github/v/release/isAlexYoung/ClaudeWeb?color=blue&label=version)](https://github.com/isAlexYoung/ClaudeWeb/releases)
[![Platform](https://img.shields.io/badge/platform-Linux%20amd64-lightgrey.svg)](#install)
[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-green.svg)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/isAlexYoung/ClaudeWeb/total)](https://github.com/isAlexYoung/ClaudeWeb/releases/latest)

English | [中文](README.zh-CN.md) | [Changelog](CHANGELOG.md)

[Install](#install) · [Quick Start](#quick-start) · [Features](#features) · [FAQ](#faq) · [License](#license)

</div>

## Install

The current stable release is **2.1.4**. Run this as root on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh | bash
```

If signed in as a user with sudo access, replace `bash` with `sudo bash`. To install a specific release, add `-s -- --version=X.Y.Z` after `bash`.

You need an amd64 (x86_64) server with at least **2 CPU cores and 2 GB RAM**, and your own Claude account or API credentials.

| System | 2.1.4 |
| --- | --- |
| Debian 12 | Supported |
| Debian 13 | Supported |
| Ubuntu 22.04 LTS | Supported |
| Ubuntu 24.04 LTS | Supported |
| Ubuntu 26.04 LTS | Supported |

ARM64 is not supported.

The installer sets up ClaudeWeb, the official Claude Code CLI, Chromium and ClaudeDesktop, configures swap, and prints the login and sudo passwords at the end. It shows numbered stages and saves download details in `/var/log/claudeweb/install.log`, readable only by root. A failed optional graphical installation can be retried later.

Packages are available in [Releases](https://github.com/isAlexYoung/ClaudeWeb/releases). The installer verifies packages against a signed release list. Without `--version`, it installs the latest stable release.

## Quick Start

1. Run the installation command on your server and keep the passwords it prints.
2. On your computer, open an SSH tunnel, replacing `YOUR_SERVER` with your server address:

   ```bash
   ssh -L 3001:127.0.0.1:3001 root@YOUR_SERVER
   ```

3. Keep that terminal open, visit [http://localhost:3001](http://localhost:3001) and enter the login password.
4. Open ClaudeWeb's terminal and run `claude`. Open its sign-in link in the built-in browser and finish signing in.
5. Create or choose a project and start chatting.

ClaudeWeb listens only on `127.0.0.1:3001`. To use it from a phone or tablet, [configure a domain](#domain-access) instead of an SSH tunnel.

The [user guide](doc/USER_GUIDE.md) covers installation, access, CMCP, migration and troubleshooting.

## Features

- Chats and projects: use Claude Code with streaming replies, quoted messages, search and collapsible thinking/execution sections.
- Server tools: work with files and run commands in the built-in terminal.
- Built-in browser: use server-side Chromium with Chinese fonts, Pinyin input and clipboard support. Press Shift to switch input modes.
- ClaudeDesktop: open it from the asterisk next to Terminal; minimize, restore, go fullscreen or close it. An orange dot marks a hidden live tool window.
- Custom plugins: install your own Git-based plugins, enable or disable them, and remove them. See the [custom-plugin guide](doc/CUSTOM_PLUGINS.md) to write one.
- Task management: scheduled tasks and a task board in the same interface.
- Backup and migration: export and restore data, including moving from ClaudeWeb inside WebDesktop. See the [migration guide](doc/USER_GUIDE.md#5-move-from-webdesktop).
- Personalization: light and dark themes, English and Simplified Chinese.
- Web updates: Settings → About → Check for updates → Update, with package verification and automatic return to the previous version if startup fails. The page offers stable releases only.

## Connect this computer with CMCP

[CMCP](https://github.com/isAlexYoung/cmcp) lets Claude on your server use this computer's files, commands and desktop tools.

Use CMCP 4.24.1 or later, add the server's SSH details, choose ClaudeWeb sign-in and enter the ClaudeWeb address and login password. Connect the device; CMCP opens the page and can sign in automatically. Local MCP tools travel through that device's background SSH connection.

See the [connection steps](doc/USER_GUIDE.md#4-connect-cmcp).

## Domain access

Run this as root during installation or afterwards:

```bash
claudeweb domain
```

Use a domain whose DNS is managed by Cloudflare; it can be purchased from another registrar. Prepare the domain's **Account ID**, **Zone ID**, and an **API token** with **Account → Cloudflare Tunnel → Edit** and **Zone → DNS → Edit** permissions for that domain.

Follow the prompts to choose a subdomain such as `claude.example.com`. Cloudflare Tunnel gives it an HTTPS address without exposing ClaudeWeb's listening port. The server needs outbound connectivity to Cloudflare on port 7844. The setup API token is not stored; only the tunnel's own token is retained.

Run `claudeweb domain --status` to check it or `claudeweb domain --remove` to delete its tunnel and DNS record. See the [domain guide](doc/USER_GUIDE.md#3-reach-it-through-a-domain-phones-and-tablets-too).

## FAQ

**How do I update?**

Open Settings → About → Check for updates → Update, or run as root:

```bash
claudeweb update
```

An older package cannot be used on a system it does not declare. `claudeweb rollback` returns to the previous installed version; see [updates and rollback](doc/USER_GUIDE.md#6-update-and-roll-back).

**What happens when I minimize or close a tool?**

Minimizing the terminal, browser or ClaudeDesktop hides the panel and keeps the session running; click its icon to restore it. Closing ends that tool's session. Closing ClaudeDesktop also removes regenerable caches and runtime files while retaining its profile and keyring. It does not erase all disk or inode usage. See [ClaudeDesktop integration](doc/CLAUDE_DESKTOP.md).

**Does each chat have its own sandbox or resource quota?**

No. ClaudeWeb, Claude CLI, the terminal, browser and ClaudeDesktop run as the same ordinary user, `claudeweb`, and share that user's files. Chromium and Electron keep their own sandboxes. ClaudeWeb adds no memory, CPU or process-count quotas; VPS and operating-system limits still apply. IPv6 is disabled globally during installation. Installation and updates use root-managed components; chat commands using the sudo integration need your confirmation and sudo password.

**I forgot a password.**

Run `claudeweb password` or `claudeweb sudo-password` as root. `claudeweb password --set` changes the web login password and signs every device out.

**The browser or ClaudeDesktop will not open.**

Run `claudeweb doctor` and check `claudeweb logs`. Retry the relevant installation with `claudeweb install-browser` or `claudeweb install-desktop`, as root.

**Where are the logs and management commands?**

Run `claudeweb status`, `claudeweb logs` or `claudeweb help` as root. Installation details are in `/var/log/claudeweb/install.log`.

**How do I uninstall?**

If using a domain, run `claudeweb domain --remove` first to remove the Cloudflare resources. Then run `claudeweb uninstall` and confirm. It removes the application and user data, keeping only `/home/claudeweb/projects` by default. `--delete-projects` deletes that folder too. Export a backup before uninstalling if you want to keep chats and settings.

**Is ClaudeWeb an Anthropic product?**

No. ClaudeWeb is an independent open-source project, not made, endorsed or supported by Anthropic. “Claude” and “Claude Code” are trademarks of Anthropic, PBC. You supply your own account or API credentials and follow Anthropic's terms.

## Contributing

Report problems and suggestions in [Issues](https://github.com/isAlexYoung/ClaudeWeb/issues). See [Contributing](CONTRIBUTING.md) for contributions and [SECURITY.md](SECURITY.md) for vulnerability reports.

## License

ClaudeWeb is a modified version of [CloudCLI UI](https://github.com/siteboon/claudecodeui) (Claude Code UI), by Siteboon AI B.V. and contributors, based on upstream commit `58a28e0`. It is not the original CloudCLI UI and is not endorsed by its authors.

The code is licensed under **GNU AGPL v3.0 or later**, with the upstream additional terms under Section 7. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md).
