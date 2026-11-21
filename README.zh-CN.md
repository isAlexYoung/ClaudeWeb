# ClaudeWeb

[English](README.md)

ClaudeWeb 是 [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) 的自托管网页界面。
把它装在你自己的 Linux 服务器上，就能在浏览器里使用 Claude Code：
对话、项目、终端、文件面板、定时任务、任务看板和内置浏览器，全部运行在这台服务器上，
使用官方 Claude CLI。

> **状态：测试版。** ClaudeWeb 2.0.1 已作为测试版发布，用于在真实服务器上验收；
> 还没有正式版。在一台可以重装的 Debian 12 服务器上试用时，需要指定版本：
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh | bash -s -- --version=2.0.1
> ```
>
> 以 root 运行。如果用的是有 sudo 权限的普通用户，把 `bash` 换成 `sudo bash`。
> 已装了较早测试版的服务器用 `claudeweb update --version=2.0.1` 更新（设置 > 关于 只提供正式版）。

## 与 Anthropic 无关

ClaudeWeb 是独立的开源项目，不是 Anthropic 开发的，也没有得到 Anthropic 的认可或支持。
"Claude" 和 "Claude Code" 是 Anthropic, PBC 的商标，这里只用来说明本软件配合什么使用。
你需要自己的 Claude 账号或 API 密钥，使用 Claude 受 Anthropic 的条款约束。

## 基于 CloudCLI UI

ClaudeWeb 是 Siteboon AI B.V. 及贡献者开发的
[CloudCLI UI](https://github.com/siteboon/claudecodeui)（Claude Code UI）的修改版本，
基于上游提交 `58a28e0`。它不是原版 CloudCLI UI，也没有得到原作者的认可。
上游的许可证及其附加条款保留在 [LICENSE](LICENSE) 和 [NOTICE](NOTICE) 中。

## 计划中的安装方式

2.0.0 发布后，在一台新服务器上以 root 运行一条命令即可安装：

```bash
curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh | bash
```

以 root 运行（有 sudo 权限的普通用户把 `bash` 换成 `sudo bash`）。

加上 `--version=2.0.0` 可以安装指定版本；默认安装最新的正式版。安装结束时会显示登录密码；之后 root 可以用
`claudeweb password` 再次查看，用 `claudeweb password --set` 换一个新密码（所有设备都会退出登录）。

计划中的运行要求：

- 先支持 Debian 12（amd64），之后支持 Ubuntu。
- 至少 2 核 CPU、2 GB 内存。安装程序会根据机器配置设置交换空间（swap）。
- 只在 `127.0.0.1` 上监听 3001 端口。没有域名时通过 SSH 隧道访问；有域名时通过
  Cloudflare Tunnel 访问。手机和平板需要域名。

管理命令（以 root 运行）：`claudeweb help`、`status`、`logs`、`doctor`、`password`、`swap`、`domain`、
`uninstall`（默认保留 `/home/claudeweb/projects`，加 `--delete-projects` 才删除项目）、`update`、`rollback`。

## 域名

安装结束时（或之后运行 `claudeweb domain`）可以给 ClaudeWeb 配一个 Cloudflare 托管域名下的 HTTPS 地址，
供手机、平板和其他电脑使用。它经 Cloudflare Tunnel 接入：服务器上的 cloudflared 主动连到 Cloudflare，
服务器不开放任何端口。需要准备：

- 该域名的 **Account ID** 和 **Zone ID**（在 Cloudflare 该域名的概览页）；
- 一个 **API Token**，权限为该域名的「帐户 > Cloudflare Tunnel > 编辑」和「区域 > DNS > 编辑」。

ClaudeWeb 可以在域名下随机生成一个名字，也可以用你指定的名字（必须正好在域名下一级，例如
`claude.example.com`，这样 Cloudflare 的免费证书才覆盖）。API Token 隐藏输入，只在配置过程中使用，
不保存；服务器上只保留这条隧道自己的令牌。配置中断后再运行 `claudeweb domain` 可以接着做，
也可以选择不继续并清理已创建的内容。`claudeweb domain --remove` 会删除这条隧道和它的 DNS 记录。
网页仍由登录密码和按来源地址的锁定保护，与经 SSH 隧道访问时相同。

更新来自用 ClaudeWeb 密钥签名的版本清单，安装包与清单一致才会被使用。`claudeweb update`（或网页的「设置 → 关于」）安装最新正式版，先备份数据库；新版本启动失败会自动换回原版本。`claudeweb rollback` 随时可以退回上一个版本。详见 [doc/RELEASING.md](doc/RELEASING.md)。

## 内置浏览器

浏览器面板显示的是运行在服务器上的 Chromium（Playwright 提供的版本，由安装程序安装），带中文字体和拼音输入法（按 Shift 切换中英文）。它以 `claudeweb` 用户运行在只有 ClaudeWeb 能访问的私有显示上，保留 Chromium 自身的沙箱；连接断开后保留 10 分钟。在另一台设备打开面板会接管同一个浏览器。`claudeweb install-browser` 可以修复浏览器。

## 安全设计

- 网页只有一个登录密码；同一来源 IP 多次输错会被暂时禁止登录。
- ClaudeWeb、Claude、终端和浏览器都以一个普通用户 `claudeweb` 运行。
  程序文件归 root 所有，更新包带签名。
- 只有在 ClaudeWeb 会话里确认后才能使用 `sudo`。
- 不收集任何使用数据。

发现安全问题请按 [SECURITY.md](SECURITY.md) 报告。

## 开发

应用代码在 [`app/`](app) 目录，需要 Node.js 22 或更新版本。

```bash
cd app
npm ci
npm run typecheck
npm run lint
npm test             # server tests
npm run test:client  # browser-side tests
```

在测试服务器（Debian 12 amd64，需要 `build-essential`、`python3`、`git`、`curl`、`xz-utils`）上构建并安装：

```bash
bash packaging/build-release.sh --version=2.0.0
sudo bash install.sh --package=release-out/claudeweb-2.0.0-linux-x64.tar.xz
```

`packaging/test-install.sh` 会在一台可丢弃的机器上完整跑一遍安装、重复安装和卸载。

2.0.0 的计划见 [`doc/PROJECT_CHECKLIST.md`](doc/PROJECT_CHECKLIST.md)。
欢迎贡献代码，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

ClaudeWeb 采用 GNU Affero 通用公共许可证 3.0 或更新版本（AGPL-3.0-or-later），
并带有来自 CloudCLI UI 的第 7 节附加条款。详见 [LICENSE](LICENSE)、[NOTICE](NOTICE)
和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
