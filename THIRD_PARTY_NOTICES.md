# Third-party notices

ClaudeWeb includes or installs the following third-party software. Each keeps
its own license.

| Component | Where | License |
| --- | --- | --- |
| [CloudCLI UI](https://github.com/siteboon/claudecodeui) (Claude Code UI) | `app/`, the base of ClaudeWeb | AGPL-3.0-or-later with Section 7 additional terms; see [LICENSE](LICENSE) and [NOTICE](NOTICE) |
| [Claude usage plugin](https://github.com/HandyS11/cloudcli-plugin-claude-usage) | `app/bundled-plugins/claude-usage/`, with ClaudeWeb integration changes | MIT; see [its license](app/bundled-plugins/claude-usage/LICENSE) |
| [noVNC](https://github.com/novnc/noVNC) | `app/public/novnc/`, with local changes described in `app/public/novnc/LOCAL_PATCHES.md` | MPL-2.0 and others; see `app/public/novnc/LICENSE.txt` |
| [Task Master](https://github.com/eyaltoledano/claude-task-master) (`task-master-ai` 0.43.1) | installed into `app/tools/taskmaster/` from npm | MIT with Commons Clause |
| [Chromium](https://www.chromium.org/) via [Playwright](https://playwright.dev/) (version pinned in `packaging/playwright-version`) | downloaded by `claudeweb install-browser` into `/home/claudeweb/.cache/ms-playwright` | BSD-3-Clause and others; Playwright is Apache-2.0 |
| TigerVNC, Openbox, Fcitx 5, Noto CJK fonts, xclip, xdotool | distribution packages installed by `install.sh` | their Debian/Ubuntu package licenses (GPL, LGPL, OFL and others) |
| [minisign](https://github.com/jedisct1/minisign) | Debian package, or upstream 0.12 static executable downloaded with a pinned SHA-256 on Ubuntu 22.04 | [ISC](https://github.com/jedisct1/minisign/blob/0.12/LICENSE) |
| npm packages | listed in `app/package-lock.json` and `app/tools/taskmaster/package-lock.json` | their own licenses, recorded in each package |

ClaudeWeb works with the official
[Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview), which
the installer will download from Anthropic, and installs the Claude Agent SDK
(`@anthropic-ai/claude-agent-sdk`) from npm as a dependency. Neither is part
of ClaudeWeb; both are covered by Anthropic's own terms, not by ClaudeWeb's
license.

The "Commons Clause" condition on Task Master forbids selling Task Master
itself. ClaudeWeb is free software and does not sell it; if you redistribute
ClaudeWeb commercially, check that condition first.
