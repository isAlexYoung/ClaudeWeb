# ClaudeWeb 使用说明

[English](USER_GUIDE.md)

ClaudeWeb 装在你自己的 Linux 服务器上，用浏览器使用 Claude Code。本文说明安装、访问方式、
CMCP 连接、从 WebDesktop 迁移，以及常见问题。所有 `claudeweb` 命令都以 root 运行，
`claudeweb help` 列出全部命令。

## 1. 安装

要求：一台可以重装的 amd64 服务器，系统为 Debian 12、Debian 13、Ubuntu 22.04、Ubuntu 24.04 或 Ubuntu 26.04，
至少 2 核 CPU、2 GB 内存。详见 [Linux 适配计划](LINUX_COMPATIBILITY_PLAN.md)。

以 root 运行，安装最新正式版（2.1.0）：

```bash
curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh | bash
```

要安装指定版本，在 `bash` 后加 `-s -- --version=X.Y.Z`。

用有 sudo 权限的普通用户登录时，把 `bash` 换成 `sudo bash`。安装程序会：

- 安装依赖、ClaudeWeb、官方 Claude Code CLI 和内置浏览器，并按内存大小设置交换空间（swap）；
- 生成**登录密码**和 **sudo 密码**，只在结束时显示一次（之后用 `claudeweb password`、
  `claudeweb sudo-password` 查看）；
- 最后询问是否绑定域名（直接回车跳过，见第 3 节）。

安装器显示 15 个编号阶段，成功结束后打印 `welcome to` / `CLAUDEWEB` 字符横幅。
下载和依赖安装详情保存到 `/var/log/claudeweb/install.log`（仅 root 可读）；失败时显示简短错误摘要和日志位置。
域名配置提示和最终密码仍显示在终端，密码不会写入该日志。

再次运行同一条命令会修复同版本的安装，不会改动登录密码和数据。

安装后，在 ClaudeWeb 的终端里运行 `claude` 登录 Claude：终端会给出一个登录链接，
用 ClaudeWeb 的内置浏览器打开并完成登录，之后聊天和终端都能直接用。

## 2. 用 SSH 隧道访问（不需要域名）

ClaudeWeb 只在服务器本机的 `127.0.0.1:3001` 上监听，公网访问不到。在你的电脑上运行：

```bash
ssh -L 3001:127.0.0.1:3001 root@服务器地址
```

保持这个窗口不关，然后在浏览器打开 `http://localhost:3001`，输入登录密码。

## 3. 用域名访问（手机、平板也能用）

需要一个托管在 Cloudflare 的域名。准备好：

- 该域名的 **Account ID** 和 **Zone ID**（在 Cloudflare 该域名的「概览」页右下角）；
- 一个 **API Token**：在 Cloudflare「我的个人资料 → API 令牌」创建，权限选
  「帐户 → Cloudflare Tunnel → 编辑」和「区域 → DNS → 编辑」（区域选这个域名）。

然后运行：

```bash
claudeweb domain
```

按提示：域名输入两次 → 选择随机子域名，或自己填一个（必须正好在域名下一级，例如
`claude.example.com`）→ 填 Account ID、Zone ID → 输入 API Token（输入时不显示）。
完成后显示 `https://…` 地址，任何设备打开它，用登录密码登录即可。

- 走的是 Cloudflare Tunnel：服务器主动连接 Cloudflare，**不开放任何端口**。服务器需要能
  向外连接 7844 端口。
- API Token 只在配置时使用，不会保存。
- 中途断了，再运行 `claudeweb domain` 可以接着做，也可以选择清理后重来。
- `claudeweb domain --status` 查看状态；`claudeweb domain --remove` 删除隧道和 DNS 记录。
- 新建的域名有时要等几分钟才能访问。

## 4. 用 CMCP 连接

CMCP（4.24.1 及以上）可以连接 ClaudeWeb，并让 Claude 使用你电脑上的文件和工具。

1. 在 CMCP 中添加设备，填好这台服务器的 SSH 登录信息，选择 ClaudeWeb 登录方式。
2. ClaudeWeb 地址填域名（如果配置了），或使用经 SSH 隧道的本机地址。
3. 填 ClaudeWeb 登录密码并打开自动登录。CMCP 会用一次性登录码登录，密码不会出现在网址里。
4. 点击「连接」：连上后会自动打开浏览器并登录。本机工具经这台设备的 SSH 后台通道连接。

「初始化／修复 ClaudeWeb 连接」能识别 ClaudeWeb 独立版，不会另装 Claude CLI。

## 5. 从 WebDesktop 迁移

旧的 WebDesktop 和其中的 ClaudeWeb 不会被改动。迁移通过备份文件完成：

1. 在旧 ClaudeWeb 的「设置 → 备份与恢复」导出备份（可以设密码）。
2. 在新服务器上打开 ClaudeWeb 的同一页面，导入这个文件。旧主目录 `/home/wdguest` 下的路径会自动
   换到 `/home/claudeweb`，对话可以在新位置继续。已有的对话和文件不会被覆盖。
3. 项目文件：在独立版 ClaudeWeb 之间迁移时，导出时可以勾选「包含项目文件夹」。WebDesktop 里的
   旧 ClaudeWeb 没有这个选项，请在**新服务器**上以 root 复制项目文件夹，例如：

   ```bash
   rsync -a root@旧服务器地址:/home/wdguest/Code/我的项目/ /home/claudeweb/Code/我的项目/
   chown -R claudeweb:claudeweb /home/claudeweb/Code
   ```

   两台服务器都需要 rsync（没有就运行 `apt-get install -y rsync`）。保持与旧主目录下相同的相对路径（`/home/wdguest/X` → `/home/claudeweb/X`），对话才能找到项目。

Claude 用户设置（去掉密钥的 settings.json、CLAUDE.md、自定义命令、智能体、技能和输出风格）也在备份里，导入时可以取消勾选；这里已有的文件不会被覆盖。

插件不随备份复制：导入完成后页面会列出备份里有、这台服务器上没有的插件，点「安装」从原来的来源重新安装（插件的密钥和设置要重新填写）。

不会迁移：Claude 的登录信息（在新服务器上重新运行 `claude` 登录）、浏览器里的登录状态。

## 6. 更新和回退

- `claudeweb update --check`：看有没有新版本；`claudeweb update`：更新到最新正式版。
  测试版用 `claudeweb update --version=X.Y.Z`。正式版也可以在网页「设置 → 关于」里更新。
- 更新前会备份数据库；新版本启动失败会自动换回原版本。
- `claudeweb rollback`：随时退回上一个版本，数据保持不变。
- Claude CLI 按官方默认在后台自动更新；「设置 → 智能体」显示它的版本，也可以手动更新。

## 7. 权限和资源的边界

- **没有每个对话单独的沙箱**：所有对话、终端和内置浏览器都以同一个用户 `claudeweb` 运行，能访问同样的项目和文件。
  一个对话里的 Claude 能读写另一个对话的项目。浏览器保留 Chromium 自己的沙箱。
- **敏感信息提示和 sudo 确认**只拦截能识别的访问，不能完全阻止同一用户下的程序读取这些内容；
  你在终端里自己执行的命令不会弹出提示。
- **资源**：ClaudeWeb 不设内存、CPU 或进程数配额，能用到服务器的全部资源；但仍受 VPS 套餐、系统、
  文件系统和运行环境本身的上限约束。磁盘满了、内存不够时，任务会失败或被结束。

## 8. 常见问题

**忘记登录密码**：`claudeweb password` 显示密码；`claudeweb password --set` 换一个新的
（所有设备都会退出登录）。

**提示登录被锁定**：同一地址连续输错 5 次会锁 1 分钟，再错 5 次锁 5 分钟，之后锁 30 分钟。
等待后用正确的密码登录。

**更新失败**：先看 `claudeweb status` 和 `claudeweb logs`。如果提示上一次更新没有完成，运行
`claudeweb rollback`。需要报告问题时，附上 `claudeweb doctor` 的输出（不含密码和密钥）。

**CMCP 连不上**：确认 `claudeweb status` 显示服务在运行；SSH 能正常登录；CMCP 是 4.24.1 或更新；
CMCP 里保存的密码与 `claudeweb password` 一致；没有因为输错被锁定。

**内存不足**：`claudeweb swap` 查看交换空间，`claudeweb swap --size=4G` 加大。内存紧张时，
系统会先结束 Claude、终端和浏览器的子进程，网页本身保持可用。在服务商后台升级内存后无需重装。

**Claude 要用 sudo**：网页会弹出确认卡片，输入 sudo 密码（`claudeweb sudo-password` 查看）才会执行，
每次都要确认。

**域名打不开**：`claudeweb domain --status` 查看隧道状态；`journalctl -u claudeweb-tunnel` 看日志；
确认服务器能向外连接 7844 端口；新域名可能要等几分钟。

**卸载**：`claudeweb uninstall`（保留 `/home/claudeweb/projects`）；加 `--delete-projects` 连项目一起删除。
配置了域名时，先运行 `claudeweb domain --remove`，才能删掉 Cloudflare 里的隧道和 DNS 记录。
