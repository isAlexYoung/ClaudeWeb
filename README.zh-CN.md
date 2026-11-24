<div align="center">

<img src="app/public/logo-256.png" width="112" height="112" alt="ClaudeWeb logo" />

# ClaudeWeb

### 在自己的服务器上，用浏览器使用 Claude Code

**把对话、项目、文件、终端、浏览器和 ClaudeDesktop 放进同一个网页界面，通过官方 Claude CLI 在你的 Linux 服务器上运行。**

[![Version](https://img.shields.io/github/v/release/isAlexYoung/ClaudeWeb?color=blue&label=version)](https://github.com/isAlexYoung/ClaudeWeb/releases)
[![Platform](https://img.shields.io/badge/platform-Linux%20amd64-lightgrey.svg)](#安装)
[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-green.svg)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/isAlexYoung/ClaudeWeb/total)](https://github.com/isAlexYoung/ClaudeWeb/releases/latest)

[English](README.md) | 中文 | [更新日志](CHANGELOG.md)

[安装](#安装) · [快速开始](#快速开始) · [主要功能](#主要功能) · [插件](#插件) · [常见问题](#常见问题) · [许可证](#许可证)

</div>

## 安装

当前正式版为 **2.2.3**。在服务器上以 root 运行：

```bash
curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh | bash
```

使用有 sudo 权限的普通用户时，把 `bash` 换成 `sudo bash`。要安装指定版本，在 `bash` 后加 `-s -- --version=X.Y.Z`。

需要一台 amd64（x86_64）服务器，至少 **2 核 CPU、2 GB 内存**，以及你自己的 Claude 账号或 API 凭据。

| 系统 | 2.2.3 |
| --- | --- |
| Debian 12 | 支持 |
| Debian 13 | 支持 |
| Ubuntu 22.04 LTS | 支持 |
| Ubuntu 24.04 LTS | 支持 |
| Ubuntu 26.04 LTS | 支持 |

不支持 ARM64。

安装程序会安装 ClaudeWeb、官方 Claude Code CLI、Chromium 和 ClaudeDesktop，配置交换空间，并在结束时显示登录密码和 sudo 密码。终端按编号显示安装阶段，下载详情保存在仅 root 可读的 `/var/log/claudeweb/install.log`。可选图形组件安装失败时，可以之后单独重试。

安装包见 [Releases](https://github.com/isAlexYoung/ClaudeWeb/releases)。安装器根据签名版本清单校验安装包；不加 `--version` 时安装最新正式版。

## 快速开始

1. 在服务器上执行安装命令，保存最后显示的密码。
2. 在你的电脑上建立 SSH 隧道，把 `YOUR_SERVER` 换成服务器地址：

   ```bash
   ssh -L 3001:127.0.0.1:3001 root@YOUR_SERVER
   ```

3. 保持终端窗口打开，用浏览器访问 [http://localhost:3001](http://localhost:3001)，输入登录密码。
4. 打开 ClaudeWeb 的终端，运行 `claude`，在内置浏览器中打开它给出的链接并完成登录。
5. 新建或选择项目，开始对话。

ClaudeWeb 只监听 `127.0.0.1:3001`。手机和平板使用[域名访问](#域名访问)，无需建立 SSH 隧道。

[使用说明](doc/USER_GUIDE.zh-CN.md)包含安装、访问、CMCP 连接、迁移和排错的详细步骤。

## 主要功能

- 对话与项目：通过 Claude Code 工作，支持流式回复、消息引用、搜索，以及思考和执行过程折叠。
- 服务器工具：在文件面板中管理文件，在内置终端中执行命令。
- 内置浏览器：运行在服务器上的 Chromium，带中文字体、拼音输入和剪贴板支持；按 Shift 切换中英文。
- ClaudeDesktop：点击终端旁的星号打开，支持最小化、恢复、全屏和关闭；隐藏但仍在运行的工具会显示橙色圆点。
- 自定义插件：从 Git 仓库安装自己的插件，支持启用、停用和删除；编写方法见[自定义插件指南（英文）](doc/CUSTOM_PLUGINS.md)。
- 任务管理：在同一界面中使用定时任务和任务看板。
- 备份与迁移：导出和恢复数据，支持从 WebDesktop 内的旧 ClaudeWeb 迁入，详见[迁移说明](doc/USER_GUIDE.zh-CN.md#5-从-webdesktop-迁移)。
- 个性化设置：明暗主题、简体中文与 English。
- 网页更新：设置 → 关于 → 检查更新 → 更新，自动校验安装包，新版本启动失败时返回原版本；网页只提供正式版。

## 插件

在 **设置 → 插件** 中直接粘贴 Git 仓库链接即可安装：

- **[ClaudeWeb Wallpaper](https://github.com/isAlexYoung/claudeweb-wallpaper)** —— 自定义静态、动图/视频及 Wallpaper Engine（视频类）壁纸插件，支持全窗自适应毛玻璃效果、暖白/浅色/深色主题独立绑定，以及可选登录页壁纸同步。

如需开发自己的插件，请参阅[自定义插件指南](doc/CUSTOM_PLUGINS.md)与独立 [Plugin SDK](doc/plugin-sdk/claudeweb-plugin.d.ts)。

如果您的插件足够优秀，将会被收录在这里 —— 欢迎提交 [Issue](https://github.com/isAlexYoung/ClaudeWeb/issues) 或 Pull Request。

## 用 CMCP 连接本机

[CMCP](https://github.com/isAlexYoung/cmcp) 可以让服务器上的 Claude 使用你电脑上的文件、命令和桌面工具。

使用 CMCP 4.24.1 或更新版本，添加服务器的 SSH 信息，选择 ClaudeWeb 登录方式，填写 ClaudeWeb 地址和登录密码。点击连接后，CMCP 会打开网页，也可以自动登录。本机 MCP 工具通过这台设备的后台 SSH 通道连接。

完整步骤见[连接说明](doc/USER_GUIDE.zh-CN.md#4-用-cmcp-连接)。

## 域名访问

安装时可以配置，也可以之后以 root 运行：

```bash
claudeweb domain
```

需要一个由 Cloudflare 托管 DNS 的域名，可以在其他厂商购买。准备该域名的 **Account ID**、**Zone ID**，以及拥有该域名「**帐户 → Cloudflare Tunnel → 编辑**」「**区域 → DNS → 编辑**」权限的 **API Token**。

按提示选择子域名，例如 `claude.example.com`。Cloudflare Tunnel 会提供 HTTPS 地址，无需对公网开放 ClaudeWeb 的监听端口；服务器需要能向 Cloudflare 的 7844 端口发起连接。配置用的 API Token 不保存，服务器只保留隧道自身的令牌。

`claudeweb domain --status` 查看状态，`claudeweb domain --remove` 删除隧道和 DNS 记录。详见[域名配置](doc/USER_GUIDE.zh-CN.md#3-用域名访问手机平板也能用)。

## 常见问题

**怎么更新？**

在「设置 → 关于 → 检查更新 → 更新」中安装新的正式版，或以 root 运行：

```bash
claudeweb update
```

旧安装包不能用于它未声明支持的系统。`claudeweb rollback` 可以返回上一个已安装版本，详见[更新和回退](doc/USER_GUIDE.zh-CN.md#6-更新和回退)。

**最小化和关闭工具有什么区别？**

最小化终端、浏览器或 ClaudeDesktop 会隐藏面板并保留会话，再点图标即可恢复。关闭会结束对应工具的会话。关闭 ClaudeDesktop 还会清理可再生缓存和运行文件，保留配置与密钥环；不会把所有磁盘或 inode 占用清零。详见 [ClaudeDesktop 说明](doc/CLAUDE_DESKTOP.md)。

**每个对话有独立沙箱或资源配额吗？**

没有。ClaudeWeb、Claude CLI、终端、浏览器和 ClaudeDesktop 都以普通用户 `claudeweb` 运行，共享这个用户的文件；Chromium 和 Electron 保留自身沙箱。ClaudeWeb 不额外设置内存、CPU 或进程数配额，仍受 VPS 套餐和操作系统限制。安装时全局禁用 IPv6；安装与更新由 root 管理的组件处理，通过 sudo 集成执行的对话命令需要你确认并输入 sudo 密码。

**忘记密码怎么办？**

以 root 运行 `claudeweb password` 查看登录密码，`claudeweb sudo-password` 查看 sudo 密码。`claudeweb password --set` 可以修改网页登录密码，所有设备会退出登录。

**浏览器或 ClaudeDesktop 打不开怎么办？**

运行 `claudeweb doctor`，通过 `claudeweb logs` 查看日志。以 root 运行 `claudeweb install-browser` 或 `claudeweb install-desktop`，单独重试对应组件的安装。

**日志和管理命令在哪里？**

以 root 运行 `claudeweb status`、`claudeweb logs` 或 `claudeweb help`。安装详情保存在 `/var/log/claudeweb/install.log`。

**怎么卸载？**

配置了域名时，先运行 `claudeweb domain --remove` 清理 Cloudflare 资源。再运行 `claudeweb uninstall` 并确认：删除程序和用户数据，默认只保留 `/home/claudeweb/projects`；加 `--delete-projects` 会连这个文件夹一起删除。需要保留对话和设置时，请先导出备份。

**ClaudeWeb 是 Anthropic 的产品吗？**

不是。ClaudeWeb 是独立开源项目，并非 Anthropic 开发，也未得到其认可或支持。“Claude”和“Claude Code”是 Anthropic, PBC 的商标。你需要提供自己的账号或 API 凭据，并遵守 Anthropic 的条款。

## 参与开发

欢迎通过 [Issues](https://github.com/isAlexYoung/ClaudeWeb/issues) 反馈问题或建议。贡献步骤见[贡献说明](CONTRIBUTING.md)，安全问题请按 [SECURITY.md](SECURITY.md) 报告。

## 许可证

ClaudeWeb 是 Siteboon AI B.V. 及贡献者开发的 [CloudCLI UI](https://github.com/siteboon/claudecodeui)（Claude Code UI）的修改版本，基于上游提交 `58a28e0`；并非原版 CloudCLI UI，也未得到原作者认可。

代码采用 **GNU AGPL 3.0 或更新版本**，并保留上游第 7 节附加条款。详见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 和[第三方声明](THIRD_PARTY_NOTICES.md)。
