# ClaudeWeb

[中文说明](README.zh-CN.md)

ClaudeWeb is a self-hosted web interface for [Claude Code](https://docs.claude.com/en/docs/claude-code/overview).
You install it on your own Linux server and use Claude Code from a browser:
chats, projects, a terminal, a file panel, scheduled tasks, a task board and a
built-in browser, all running on that server with the official Claude CLI.

> **Status: in development.** ClaudeWeb 2.0.0, the first standalone release,
> is not out yet. The installer, the login and the `claudeweb` command work;
> releases to download, updates, domains and the built-in browser are still
> being built. Until the first release you can build a package yourself (see
> [Development](#development)).

## Not affiliated with Anthropic

ClaudeWeb is an independent open-source project. It is not made, endorsed or
supported by Anthropic. "Claude" and "Claude Code" are trademarks of
Anthropic, PBC, used here only to say what the software works with. You need
your own Claude account or API key, and your use of Claude is governed by
Anthropic's terms.

## Based on CloudCLI UI

ClaudeWeb is a modified version of
[CloudCLI UI](https://github.com/siteboon/claudecodeui) (Claude Code UI) by
Siteboon AI B.V. and contributors, based on upstream commit `58a28e0`. It is
not the original CloudCLI UI and is not endorsed by its authors. The upstream
license and its additional terms are kept in [LICENSE](LICENSE) and
[NOTICE](NOTICE).

## Planned installation

When 2.0.0 is released, installation will be one command run as root on a
fresh server:

```bash
curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh | sudo bash
```

`--version=2.0.0` will pick a specific version; the default is the latest
stable release. The installer prints the login password at the end; root can
show it again with `claudeweb password` and replace it with
`claudeweb password --set`, which signs every device out.

Planned requirements:

- Debian 12 (amd64) first; Ubuntu later.
- At least 2 CPU cores and 2 GB of memory. The installer sizes swap from the
  machine.
- Port 3001 on `127.0.0.1` only. Without a domain you reach ClaudeWeb through
  an SSH tunnel; with a domain, through Cloudflare Tunnel. Phones and tablets
  need a domain.

Management commands (run as root): `claudeweb help`, `status`, `logs`,
`doctor`, `password`, `swap`, `uninstall` (keeps `/home/claudeweb/projects`
unless you add `--delete-projects`). `update` and `rollback` come with signed
releases.

## Security model

- One login password for the web page, with lockout per source IP after
  repeated failures.
- ClaudeWeb, Claude, the terminal and the browser run as one unprivileged user,
  `claudeweb`. Program files belong to root, and updates are signed.
- `sudo` is only available after you confirm it in the ClaudeWeb session.
- No telemetry.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Development

The application is in [`app/`](app). It needs Node.js 22 or later.

```bash
cd app
npm ci
npm run typecheck
npm run lint
npm test             # server tests
npm run test:client  # browser-side tests
```

To build a release package and install it on a test server (Debian 12 amd64,
with `build-essential`, `python3`, `git`, `curl` and `xz-utils`):

```bash
bash packaging/build-release.sh --version=2.0.0
sudo bash install.sh --package=release-out/claudeweb-2.0.0-linux-x64.tar.xz
```

`packaging/test-install.sh` runs the whole install, repair and uninstall
cycle on a disposable machine.

[`doc/PROJECT_CHECKLIST.md`](doc/PROJECT_CHECKLIST.md) tracks the plan for
2.0.0. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

ClaudeWeb is licensed under the GNU Affero General Public License v3.0 or
later, with the additional terms under Section 7 that come from CloudCLI UI.
See [LICENSE](LICENSE), [NOTICE](NOTICE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
