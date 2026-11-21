# ClaudeWeb 独立版项目清单

日期：2026-11-20。阶段：需求整理，尚未实现产品代码或创建远程仓库。

目标是建立独立、开源、可一键安装的 ClaudeWeb，保留现有 ClaudeWeb 全部功能，整合必要的浏览器运行及安装更新能力，取消对 WebDesktop 和 fa-build 的运行依赖。

“已确认决策”的勾选表示需求已确定；实现任务的空框表示尚未完成开发或验收。

## 已确认决策

- [x] 文档放在 `doc/`。
- [x] 新仓库名称为 `ClaudeWeb`，仓库公开，安装脚本与应用代码同仓维护。
- [x] 仓库账号按本次需求记录为 `isAlexYoung`。
- [x] 保留现有 ClaudeWeb 的全部功能，以及已有修复和交互改进。
- [x] 不实现 WebDesktop 桌面、开始菜单、任务栏和桌面多窗口管理。
- [x] 一键安装默认安装最新稳定版，不询问安装哪个版本。
- [x] ClaudeWeb 后台、Claude CLI、终端、浏览器尽量共用普通用户 `claudeweb`。
- [x] 安装、系统配置、更新所需的高权限操作由短时运行的 root 安装器或更新组件执行。
- [x] 保留网页更新入口：**设置 → 关于 → 检查更新 → 更新**，不要求用户进入 SSH 才能更新。
- [x] 默认安装最新版与后台自动升级分开处理，不默认在工作过程中自行升级或重启。
- [x] 不额外设置 ClaudeWeb 专属资源配额，尽可能使用 VPS 的可用资源。
- [x] 网络层全局禁用 IPv6，只保留必要的权限、鉴权和安全机制。
- [x] 产品界面、命令、环境变量和运行路径统一使用 `claudeweb` 命名，独立维护发布链。
- [x] Claude Desktop 属于后续目标，目前不实现；未来入口放在右上角“终端”“文件夹”附近。
- [x] 终端、浏览器及未来 Claude Desktop 优先统一用户，确有兼容性原因时允许分开。
- [x] 首期面向 Debian 12 amd64 开发与验收，后续扩展支持 Ubuntu 等其他 Linux 发行版。
- [x] 项目目录清晰优雅，分门别类的放置文件，按行业习惯整理。
- [x] 版本号独立，从 2.0.0 开始；发布 2.0.0 正式版之前的版本都是测试版。
- [x] 每次发布在代码和发布清单中标明“正式版”或“测试版”。设置 → 关于 只向用户提供正式版；测试版验证无误后可转为正式版。
- [x] 一键安装默认安装最新正式版；可用 `--version=2.0.0` 指定版本，不加参数时安装最新正式版。
- [x] 本项目与已安装的 WebDesktop、集成版 ClaudeWeb 无关，不做检测、兼容或共存处理。
- [x] 不再合并上游 CloudCLI（siteboon/claudecodeui），长期独立维护。
- [x] 不改名；README 声明与 Anthropic 无任何隶属关系，并附免责声明和版权声明。
- [x] 最低配置 2 核 2 GB 内存，在 2.0.0 正式版 README 中写明，不考虑 1 GB 内存的机器。
- [x] Claude 可以使用 sudo，但每次都由用户在 ClaudeWeb 会话中确认，可输入 sudo 密码同意，也可拒绝。
- [x] WSL2 只做初步验收，正式验收在专门的测试 VPS 上进行。
- [x] 只有一个登录密码，没有网页注册或单独的管理员账号：密码由一键安装生成并在最后输出，另提供查询密码和修改密码的命令。
- [x] 安全模型采用单用户：Claude、终端与后台同为 `claudeweb` 用户；程序文件归 root，更新只接受签名安装包，sudo 密码不经过 Claude 可见的位置。
- [x] 浏览器优先稳定，首选 Playwright 提供的 Chromium（固定版本、各发行版一致）；不支持部分专有视频解码不作为问题。
- [x] 不提供一键导出所有数据；只保留现有设置中的导出数据功能。
- [x] 未配置域名时只监听本机地址，通过 SSH 隧道访问（与 CMCP 现有方式一致），不在公网 IP 上提供明文 HTTP。
- [x] 只使用 SQLite，不再安装和维护 PostgreSQL。
- [x] 不考虑 VPS 位于中国大陆的网络环境。
- [x] 不收集任何使用数据，不上报统计。
- [x] 接受外部贡献（PR）。
- [x] 域名通过 Cloudflare Tunnel 接入：服务始终只监听本机，VPS 不对公网开放端口。
- [x] 手机和平板访问需要配置域名；电脑可用 SSH 隧道或 CMCP。
- [x] 只新仓库搬迁测试代码，不搬迁历史测试记录、变更记录和内部报告；CHANGELOG 从 2.0.0 开始。

## 功能保留清单

实施前，以当前已发布 ClaudeWeb 建立完整功能基线，逐项记录界面、接口、配置和数据依赖。以下分组不能替代完整盘点。

- [ ] 聊天：流式生成、模型、思考强度、停止、重新生成、编辑、复制及模型信息。
- [ ] 思考与执行过程：整体折叠、生成过程中折叠、工具结果显示。
- [ ] 会话与项目：历史、项目目录、最近记录、重命名、搜索、关键词高亮及跳转。
- [ ] 旁聊与引用：旁聊管理、原文定位、引用标签、引用编辑、可读内容复制。
- [ ] 输入与附件：草稿、中文输入法、光标稳定、上传及已有发送操作。
- [ ] 文件：查看、编辑、上传下载及基线中已有的文件管理能力。
- [ ] 终端：交互终端、项目内执行、主题及已有会话行为。
- [ ] 浏览器：画面、键鼠、剪贴板、下载、关闭及断线重连。
- [ ] 集成：现有模型提供方、MCP、插件、技能及其配置。
- [ ] 项目记忆、Git、工作树、任务和定时功能。
- [ ] 用量信息、额度环、额度刷新稳定布局和用量插件。
- [ ] 导出 HTML、Markdown、JSON，保留保存位置选择和复制功能。
- [ ] 主题、语言、命令菜单、滚动动画、隐藏滚动条及已有布局修复。
- [ ] 设置、关于、版本显示和网页内更新。
- [ ] 补齐基线中存在但未被以上分组覆盖的功能。

## 独立运行与权限

- [x] ClaudeWeb 自己提供登录、会话和退出；不提供网页注册或首次设置页面，避免他人抢先创建账号。（2026-11-20：只输一个密码，会话记录在服务器端）
- [x] HTTP、WebSocket、终端、文件、浏览器和更新接口统一经过鉴权。（2026-11-21 审查：/api 下除登录、状态和 CMCP 握手外都经 authenticateToken；聊天、终端、插件和浏览器的 WebSocket 在握手时统一校验；备份下载用一次性票据；智能体接口要 API 密钥）
- [x] 移除对 WebDesktop 外层认证的依赖，不能把当前信任外层认证的平台模式直接暴露公网。（2026-11-20 已删除平台模式。2026-11-20 已换成自己的密码登录，上游注册页已删除。）
- [x] 创建普通运行用户 `claudeweb`，统一 HOME、工作区和子进程环境。（install.sh，HOME `/home/claudeweb`）
- [x] 统一项目、下载、配置的文件所有权和默认权限，减少跨用户协调。（单一用户 claudeweb：项目、下载和聊天数据都归它，服务 UMask 0007；/etc/claudeweb 为 root:claudeweb 0750，密码文件只有 root 可读）
- [x] 安装程序和系统配置由安装器管理，应用不直接替换系统级程序文件。（程序在 /opt/claudeweb，归 root；服务以 claudeweb 运行，写不进去；更新只经 root 的 claudeweb 命令）
- [x] root 更新组件只执行已定义操作，不提供通用 root Shell 接口。（claudeweb-update.socket → `claudeweb serve-update`，只接受 check 和“更新到更新的正式版”）
- [x] 浏览器保留自身沙箱，不通过关闭内部沙箱强行统一身份。（Chromium 不加 --no-sandbox）
- [x] 说明多个会话共享运行用户和项目权限，不宣称每个聊天有独立沙箱。（使用说明「权限和资源的边界」）
- [x] 将浏览器所需的最小图形运行和画面转发组件独立出来，由 ClaudeWeb 管理。（Xvnc + Openbox + Fcitx5，由应用内的浏览器模块启动和停止）
- [x] 内置浏览器安装中文字体（如 Noto CJK），正常显示中文网页；保留浏览器内的中文输入（现有为 fcitx5）。
- [x] 浏览器可在无物理显示器的 VPS 工作，不依赖 WebDesktop 网关或桌面界面。
- [x] 不要求存在旧的 `wdterm`、`wdguest`、`wdsvc`、`wdgui`、WebDesktop 数据库或安装状态。（2026-11-21 清掉了更新接口里的 webdesktop 空字段和 WebDesktop 登录来源；只剩导入旧备份时把 /home/wdguest 换成 /home/claudeweb）
- [x] 不依赖原私有仓库、Deploy Key、WebDesktop 版本或 fa-build 运行环境。（安装和更新只用公开仓库的 install.sh、签名清单和 GitHub Release）
- [x] 为未来图形应用扩展留出接口，本阶段不实现或安装 Claude Desktop，不显示不可用占位按钮。（浏览器用的 Xvnc 显示和 Openbox 由应用管理，以后可运行其他图形程序；界面没有 Claude Desktop 占位按钮）

## CMCP 连接

- [ ] CMCP 可以直接连接独立版 ClaudeWeb：自动登录握手（使用 CMCP 保存的密码，页面不再要求输入）、工具授权凭据和 MCP 转发通道，Claude 能使用电脑上的文件和工具。（2026-11-21 用户选了“改 CMCP”：自动登录用一次性登录码已实现（本仓库 `/api/auth/cmcp`、CMCP 4.24.0）；本机工具走设备的 SSH 后台通道，不再做网页 MCP 转发和工具凭据。2026-11-21 用户在真实 VPS 上用 CMCP 4.24.1 验收自动打开和登录通过）
- [ ] 支持 CMCP 现有的“通过 SSH 自建 ClaudeWeb”连接方式。（CMCP 4.24.0 的“初始化／修复 ClaudeWeb 连接”能识别 claudeweb 服务和用户；待真实 VPS 验证）
- [x] 明确旧版 CMCP 连接独立版时的兼容范围和提示。（4.24.0 之前的 CMCP 把独立版当作自行安装的 CloudCLI：网页可打开，需手动输入密码）
- [x] CMCP 中的“CloudCLI”名称后续改为“ClaudeWeb”，属于 CMCP 项目，本项目暂不改动。（CMCP 4.24.0 已改，专指上游原版时仍写“自行安装的 CloudCLI”）

## 登录、多设备与密码

现有这部分功能由 WebDesktop 提供，独立版需要重新实现。

- [x] 最多 3 台设备同时登录；已有设备登录时，新登录选择“加入”或“接管”，接管前再次确认，满 3 台时先选一台退出。（2026-11-21；最早登录的设备是主设备，只有主设备能在网页上开始更新）
- [x] 设置中的登录设备列表：设备类型、来源（网页、CMCP）、IP、时间，标出主设备和本机，可踢出其他设备。（来源“CMCP”等 CMCP 自动登录接入后才会出现）
- [x] 新设备登录时提醒其他设备，可选“知道了”或“踢出”。
- [x] 手动网页登录每台设备闲置 1 小时后退出，真实操作及忙碌的主会话续期，后台轮询不续期。
- [x] 退出登录只结束本设备，修改密码让所有设备退出。（被结束的登录，已打开的 WebSocket 连接在 15 秒内断开）
- [x] 一键安装生成登录密码，在安装结束时输出。（只显示在屏幕上，不写入安装日志）
- [x] root 命令查询当前登录密码（如 `claudeweb password`），密码保存在只有 root 可读的文件中。不考虑攻击者已取得 root 权限的情况。
- [x] root 命令修改登录密码（如 `claudeweb password --set`；`--set --stdin` 可自己输入，终端里不显示），修改后同步更新上述文件，查询到的始终是当前密码，并让所有设备退出。
- [x] 密码验证失败限制按访问者 IP 分别计数：同一 IP 连续 5 次失败禁用 1 分钟，再 5 次禁用 5 分钟，再 5 次及之后每 5 次禁用 30 分钟；该 IP 登录成功后计数清零。页面显示剩余等待时间。CMCP 自动登录同样受此限制。通过域名或反向代理访问时，只采信自己的代理传来的真实 IP，避免伪造。（2026-11-20 网页登录已实现：只在本机连接上采信 Cloudflare 的 CF-Connecting-IP；24 小时没有再失败也会清零。2026-11-21 CMCP 换取登录码也计入同一锁定）

## sudo 授权

- [x] Claude 或终端命令需要 sudo 时，在 ClaudeWeb 会话中弹出确认，显示要执行的命令；用户可输入 sudo 密码同意，也可拒绝。（2026-11-21 实现：聊天命令的 PATH 里先是 ClaudeWeb 的 sudo（app/sudo-shim），请求显示在每个已登录的页面右下角，含完整命令和目录；终端里仍是 sudo 自己问密码。虚拟机测试 packaging/test-sudo.sh。真实 Claude 会话里的 Bash 是否拿到这个 PATH 待真实 VPS 确认）
- [x] 密码只交给 sudo，不进入 Claude 上下文、对话记录、日志或浏览器存储，也不保存。（服务不记录、不保存；页面只在输入框里保留到发出为止；测试检查服务日志里没有密码）
- [x] 拒绝、超时或密码错误时命令失败并告知 Claude，不自动重试。（只失败一次，并提示 Claude 不要重试）
- [x] 不配置无密码 sudo；安装时设置 `claudeweb` 用户的 sudo 密码，并提供修改命令。（`claudeweb sudo-password` [--set [--stdin]]；安装结束时显示一次，不写入日志；同时禁止这个用户通过 SSH 登录（DenyUsers））

## 敏感信息提示

- [x] Claude 要读取或外发以下内容前，在会话中提示“此类内容为用户敏感信息”，用户确认后才继续，可拒绝：Claude 的登录凭据；内置浏览器的 Cookie 和登录数据；ClaudeWeb 数据库、登录密码文件和签名密钥。（2026-11-21 实现：Claude 运行时的 PreToolUse 钩子，在权限模式之前执行，关闭工具确认时也会问；卡片显示“此类内容为用户敏感信息”和这次调用要碰的内容，只允许这一次或拒绝；无人值守的运行直接拒绝）
- [x] 敏感路径清单集中维护，覆盖文件读取、搜索和命令执行等工具调用。（server/modules/sensitive-access：文件路径按会话目录和 ~ 解析，命令行和搜索模式按名称匹配）
- [x] 说明提示的边界：只拦截能识别的访问，不能完全阻止同一用户下的程序读取；用户在终端中自己执行的命令不弹提示。（卡片上写明了这一边界）

## Claude CLI

- [x] 安装官方 Claude Code CLI，聊天（通过 Agent SDK 启动）与终端中的 `claude` 使用同一份程序和同一份登录信息。现有实现为 `/opt/claude-cli/.local/bin/claude`，由 `CLAUDE_CLI_PATH` 指定。（独立版：官方安装器装到 /home/claudeweb/.local/bin/claude，CLAUDE_CLI_PATH 指向它，终端 PATH 里也是它，登录信息同在 ~/.claude）
- [ ] 登录流程：在 ClaudeWeb 终端运行 `claude` 登录，终端输出登录链接，用 ClaudeWeb 内置浏览器打开并完成登录，之后聊天和终端都可直接使用。
- [ ] 确定 CLI 是否自动更新，以及 CLI 版本与 ClaudeWeb 的兼容检查。

## 资源和网络

- [x] 取消现有项目对内存、Swap、CPU、进程及线程数量设置的专属配额。（服务不设内存、CPU 配额，TasksMax=infinity）
- [x] 检查 systemd 服务、父级 slice、任务数和进程限制的最终值，避免继承旧配额。（claudeweb.service：TasksMax=infinity、LimitNOFILE=65536，没有 MemoryMax、CPUQuota，位于默认的 system.slice）
- [x] 不人为设置偏小的 Node.js 堆上限或子进程配额。
- [x] 项目和数据直接使用普通目录，不再创建固定大小的工作区 ext4 镜像。
- [x] 不单独划分较小的磁盘容量或 inode 池。（数据在普通目录 /home/claudeweb、/var/lib/claudeweb）
- [x] 不沿用现有小容量私有临时文件系统，正常使用 VPS 临时空间。（主服务不设 PrivateTmp，用系统 /tmp；备份上传放在 ~/.claudeweb/backup-imports）
- [x] 使用普通宿主机 IPv4 网络，使终端和浏览器能访问相同的本地服务。（服务不设 PrivateNetwork、IPAddressDeny）
- [x] 不沿用当前只允许公网 TCP 80、443 和 DNS 的专用出口规则。（安装器不写防火墙规则）
- [x] 全局持久禁用 IPv6，配置前确认 IPv4 管理连接可用，重启后验证。（install.sh 写入 sysctl；当前 SSH 连接走 IPv6 或没有 IPv4 默认路由时跳过。重启后验证还没在真实 VPS 上做）
- [x] 保留登录校验、管理凭据保护、浏览器内部沙箱和必要的输入检查。（登录密码和按地址锁定、敏感信息提示、Chromium 自身沙箱、备份导入的条目检查等）
- [ ] 停止任务、终端和图形会话时正确回收对应子进程，保留持久数据。
- [ ] 维护日志、临时文件和可再生缓存，不删除项目、聊天、记忆和登录数据。
- [x] 说明资源仍受 VPS 套餐、宿主系统、文件系统及运行时本身上限约束。（使用说明「权限和资源的边界」）
- [ ] 内存耗尽时优先回收 Claude、终端和浏览器子进程，主服务最后被系统结束，网页保持可用。（OOMPolicy=continue：子进程被结束不会停掉服务。2026-11-21：服务 OOMScoreAdjust=-100，应用每 5 秒把自己启动的所有进程调到 500（server/modules/oom-priority），子进程先于服务被结束，sshd 不受影响。安装测试检查分值；真实内存耗尽未在 VPS 上试过）
- [x] 不按安装时的内存写死数值：在服务商后台增加内存后，无需重装即可使用新增内存。（服务没有内存上限，也不设 Node 堆上限；swap 只在没有时按内存建一次，之后用 claudeweb swap 调整）
- [x] 一键安装根据机器实际配置创建或调整 swap，安装后提供主动调整 swap 的命令。（没有 swap 时按内存大小建 2–4 GiB；`claudeweb swap --size=NG / --off`）
- [ ] 磁盘使用情况与清理后续放进 ClaudeWeb 设置，目前不实现。

## 一键安装与发布

- [x] 仓库提供简洁的 `install.sh`，公开下载，不要求授权私有仓库。（公开仓库 main 分支的 install.sh）
- [x] 默认选择最新稳定版，不询问版本，不默认安装预发布版。
- [x] 一次安装固定一个版本及其发布清单，避免中途更新造成文件混用。（每个版本一个目录，`current` 链接切换）
- [x] 提供预构建发布包，减少 VPS 现场编译的时间和内存开销。（`packaging/build-release.sh`：自带 Node.js 22，约 64 MB，解压 539 MB；CI 自动构建待做）
- [x] 校验发布包和清单一致，记录来源、版本及失败阶段。
- [x] 检查系统、架构、依赖、端口和实际可用空间，不据此另建受限工作区。
- [x] 完成用户、目录、依赖、服务和管理员初始化，输出访问方式。（2026-11-20：WSL2 Debian 12 全新安装测试 32 项通过）
- [x] 保留 fa-build 中适用的安装状态、错误定位、失败保留现场和恢复机制。（安装分步显示，失败时说明出错的步骤和日志 /var/log/claudeweb/install.log；再次运行即修复；更新状态记在 /var/lib/claudeweb-update，claudeweb rollback 在任何未完成状态都能恢复）
- [x] 重复执行安装入口时识别既有安装，不覆盖用户数据或重复初始化。（再次运行即修复，不换密码）
- [x] 整合域名与 HTTPS 能力，包括 Cloudflare 托管域名，允许跳过域名配置。（2026-11-21：`claudeweb domain`，安装结束时询问，回车或 Ctrl+C 跳过；`packaging/test-domain.sh` 用本地模拟的 Cloudflare 接口 24 项通过，真实 Cloudflare 尚未验证）
- [x] 跳过域名时服务只监听本机地址；安装结束时输出 SSH 隧道的连接方法和本地访问地址，并说明可用 CMCP 连接，手机和平板需要配置域名。
- [x] 域名经 Cloudflare Tunnel 接入，不对公网开放 80/443 端口；可沿用 WebDesktop 现有的 Cloudflare 配置流程。（沿用：域名输入两次、随机或指定一级子域名、Account ID、Zone ID、隐藏输入的 API Token；未完成的配置可继续或清理；cloudflared 来自 Cloudflare 签名源并固定密钥）
- [x] 固定默认本机端口，写进文档和 SSH 隧道说明；端口被占用时安装给出明确错误，不自动更换端口。
- [x] Chromium 和 Node.js 随 ClaudeWeb 新版本一起更新；出现严重安全漏洞时单独发布修复版，只为最新正式版提供修复。（写入 doc/RELEASING.md「Bundled components」）
- [x] 现有 ClaudeWeb 前后端自动测试搬入新仓库并接入 CI，提交和 PR 都要运行。（2026-11-21：.github/workflows/ci.yml，推送到 main 和每个 PR 都运行：Linux 上的类型检查、lint、构建和前后端测试，Debian 12 构建安装包，再在全新 Debian 12 虚拟机里跑安装、更新、浏览器、多设备和 sudo 测试）
- [x] 发布包附第三方许可证声明：除 CloudCLI 的 AGPL 外，还包括 Playwright Chromium、noVNC、字体及其他打包组件。（`THIRD_PARTY_NOTICES.md` 随发布包一起）
- [ ] 后续计划：支持 arm64 架构，首期只做 amd64。
- [ ] 首期完成 Debian 12 amd64 支持；后续增加 Ubuntu 等 Linux 发行版，按发行版和版本分别验收后声明支持。
- [ ] 将软件包、服务、图形依赖和系统配置差异集中到平台适配层，避免业务功能与 Debian 12 路径或包名绑定。
- [ ] 建立发行版支持矩阵；Ubuntu 等后续目标的具体版本、架构和测试环境在对应阶段确定。
- [x] 发布清单标明正式版或测试版；一键安装和网页更新默认只取正式版，测试版只能用 `--version` 指定安装。
- [x] 测试版转为正式版时只修改发布标记，不重新构建，安装包和校验值保持不变。（`packaging/release-list.py promote`）
- [x] 版本清单作为发布文件提供，不依赖 GitHub API（未登录时每小时只能请求 60 次）。（`releases` 分支经 raw.githubusercontent.com 读取）
- [x] 发布清单签名（如 minisign），公钥内置于安装器和更新组件。（key id 8D95EBD30103FEDD；私钥在维护者电脑上，不在仓库）
- [x] 发布前必须通过两项自动测试：全新安装；先安装上一个正式版，再通过网页更新到新版本。（2026-11-20：`packaging/test-install.sh` 32 项、`packaging/test-update.sh` 36 项在 WSL2 全新 Debian 12 通过；接入 CI 待做）（CI 的 install 和 update 虚拟机测试；2026-11-21 起 CI 改为发布前手动启动）
- [x] 新版本启动和健康检查期间不写入数据库，避免更新校验误判用户数据被改动（WebDesktop 3.0.6 的教训）。（更新程序只检查服务能否应答，不比对数据库，启动时的写入不会被误判；迁移只能增加表和列，见 doc/RELEASING.md）
- [x] 公开仓库 CI 确认托管运行器可运行虚拟机测试，测试构件设置保留期。（GitHub 托管的 Ubuntu 运行器用 KVM 启动固定版本、校验过 SHA-512 的 Debian 12 云镜像；测试包保留 3 天，虚拟机日志保留 7 天）

未来命令形式示意，仓库和脚本尚未创建，当前不可执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh)
```

指定版本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh) --version=2.0.0
```

## 管理命令

- [x] root 终端提供 `claudeweb` 管理命令：`help`、`status`、`logs`、`doctor`（收集诊断信息，不含密码和密钥）、`update`、`rollback`、`password`（查询与修改登录密码）、调整 swap、`uninstall`。不提供一键备份导出命令；更新失败回滚所需的内部备份由更新组件自动管理。（全部已有，另有 sudo-password、install-browser、domain）
- [x] `claudeweb uninstall` 只询问用户是否执行卸载：输入 `y` 执行，输入 `n` 停止；不提供导出操作。
- [x] 默认不删除项目文件夹，确认提示中写明项目保留的路径；使用 `claudeweb uninstall --delete-projects` 时一并删除项目文件夹，确认提示中明确说明项目将被删除。
- [x] `claudeweb rollback` 在更新失败或卡在维护状态时退回上一个版本，不还原、不删除用户数据；在任何未完成的更新状态下都能使用，并写进 `claudeweb help`（WebDesktop 3.0.6 的教训）。
- [x] `claudeweb help` 列出所有可用命令及常用参数（如 `--delete-projects`），每条附一句说明；不带参数运行 `claudeweb` 或输入未知命令时也显示这份说明。

## 设置关于页面中的更新

- [x] 设置 → 关于 显示当前版本、最新稳定版、更新说明和检查更新入口。
- [x] 同页提供“更新”按钮，继续保留现有便捷操作方式。
- [x] 网页调用受控更新组件，完成下载、校验、备份、版本切换及重启。（root 的 claudeweb-update.socket 只接受 check 和更新到更新的正式版）
- [x] 展示真实更新阶段，防止重复提交。
- [x] 更新前明确正在运行任务的处理方式，避免未提示的工作中断。（2026-11-21：更新确认里显示正在运行的对话数（含定时任务），并说明重启会中断它们）
- [x] 页面断线后自动重连，展示更新结果和实际运行版本。
- [x] 启动或健康检查失败时回滚，同时验证数据库迁移的回滚兼容性。（自动换回原版本，数据库不还原只备份；迁移只能增加表和列，见 doc/RELEASING.md）
- [x] 保留配置、项目、登录、聊天、记忆和插件数据。
- [x] 后续更新保留统一普通用户方案，不恢复旧身份、路径和资源配额。（doc/RELEASING.md：更新只换 /opt/claudeweb 下的程序）
- [x] 命令行更新与恢复作为辅助入口，正常更新不依赖 SSH。

## 命名和目录

已确定的布局如下：

| 用途 | 路径或名称 |
| --- | --- |
| 产品与仓库 | `ClaudeWeb` |
| 管理命令和运行用户 | `claudeweb` |
| 程序版本 | `/opt/claudeweb/releases/<version>` |
| 当前程序 | `/opt/claudeweb/current` |
| 系统配置 | `/etc/claudeweb` |
| HOME | `/home/claudeweb` |
| 默认项目 | `/home/claudeweb/projects` |
| 应用持久数据 | `/var/lib/claudeweb` |
| 主服务 | `claudeweb.service` |
| 默认本机端口 | `127.0.0.1:3001` |
| 日志 | systemd journal，必要文件放 `/var/log/claudeweb` |

- [x] 更新界面、包名、命令、环境变量、默认路径和发布脚本。（发布脚本在第 5 步编写）
- [x] 更新插件标识与配置引用，避免改名导致插件失联。（插件目录保持上游的 ~/.claude-code-ui/plugins，内置插件由 CLAUDEWEB_BUNDLED_PLUGINS_DIR 指定，改名不影响已装插件）
- [x] 独立维护源码、构建、版本、发布包和更新清单，不依赖 CloudCLI 发布链。（Release package 工作流构建，releases 分支放签名清单，GitHub Release 放安装包）
- [x] 保留第三方许可证、版权和来源声明，不能错误替换声明中的原项目名称。（见 `NOTICE`、`THIRD_PARTY_NOTICES.md`）
- [x] 核对现有 AGPL 与附加署名条款，明确本项目为修改后的独立发行版本。
- [x] 使用全新的提交历史建仓，不导入私有仓库历史；清除内部报告、CI 与部署密钥引用、个人路径、其他账号名和 VPS 主机名。（首次推送前改写了全部本地提交，并扫描确认）
- [x] 补充 `SECURITY.md`（漏洞报告方式）、`CHANGELOG` 和中英文 README。
- [x] README 声明与 Anthropic 无任何隶属关系，附免责声明和版权声明。
- [x] 关于页面的源码链接指向公开仓库，替代原 `cloudcli.patch`。
- [x] README 写明不收集任何使用数据。
- [x] 编写用户文档：安装、SSH 隧道与域名访问、CMCP 连接，以及常见问题（忘记密码、更新失败、CMCP 连不上、内存不足）。（2026-11-21：`doc/USER_GUIDE.zh-CN.md` 和 `doc/USER_GUIDE.md`，另含从 WebDesktop 迁移、更新回退、sudo、域名排查、卸载）
- [x] 编写 `CONTRIBUTING.md`：本地开发与测试方法、代码规范、提交说明要求；PR 须通过 CI 并由维护者审查后合并。
- [x] 准备 Issue 模板（问题报告附 `claudeweb doctor` 输出、功能建议）和 PR 模板。
- [x] 贡献的许可证规则：贡献内容按本仓库许可证（AGPL）发布，提交时签署 DCO（`git commit -s`），确认贡献者有权提交这些代码。
- [x] 漏洞不走公开 Issue，按 `SECURITY.md` 私下报告。

## 旧数据导入

- [x] 独立安装不自动改动已有 WebDesktop 或 ClaudeWeb 服务。（导入只读备份文件，不连接也不改动旧服务器）
- [x] 明确导入流程，迁移前备份并保留原始数据。（2026-11-21 用户选定：在旧 ClaudeWeb 的「设置 → 备份与恢复」导出，在独立版同一页面导入；旧服务器上的数据不动，导入从不覆盖已有文件）
- [ ] 处理项目、聊天、Claude 配置、记忆、插件和应用数据库。（已做：聊天、项目记忆、检查点、任务清单、图片、应用数据库中的标题/归档/草稿/定时任务/偏好；导出时可勾选项目文件夹（用户选定）。未做：插件和 Claude 用户级设置不进备份，需重新安装；WebDesktop 内置的旧 ClaudeWeb 还没有“带上项目文件夹”的导出，要用它带项目需给 WebDesktop 发新版，或用 rsync 复制项目）
- [x] 转换绝对路径、文件所有权及旧 `cloudcli` 标识。（备份记录的主目录与本机不同时（如 /home/wdguest → /home/claudeweb），对话文件夹名、对话记录里的 cwd、数据库中的项目路径都换到新主目录；文件由 claudeweb 写入；旧 `cloudcli-backup` 格式和 `cloudcli/` 目录照常导入）
- [x] 单独验证浏览器配置和密钥环可迁移性，不承诺复制后自动保持登录。（决定不迁移浏览器配置；使用说明写明浏览器里的登录要重新登录）
- [x] 导入失败保留原安装可用，提供可定位的错误。（预览前整份检查，不安全的条目直接拒绝；错误带代码和原因；已有文件不覆盖）

## 实施和验收阶段

### 文档和基线

- [x] 建立本项目清单和 Debian 12 WSL2 创建说明。
- [x] 在本机创建并验证 `ClaudeWeb-Debian12` WSL2 测试环境（记录只保存在本地），基础包与 systemd 正常，干净基线已导出；尚未安装产品。
- [x] 核对远程仓库账号（2026-11-20）：GitHub 账号 `isAlexYoung` 存在，该账号下尚无 `ClaudeWeb` 仓库。
- [x] 固定功能基线：ClaudeWeb 1.0.17，源码标签 `claudeweb-src-v1.0.17`，提交 `898dc736`（原私有 WebDesktop 仓库）。
- [ ] 准备数据样本（项目、聊天、旁聊、记忆、插件配置），用于功能回归和旧数据导入验证。
- [x] 首期平台 Debian 12 amd64；默认本机端口 3001（与 CMCP“通过 SSH 自建”的默认端口一致）；路径采用下方「命名和目录」表格。

### 独立版本

- [x] 本地仓库初始化（分支 `main`），按原样导入 1.0.17 基线到 `app/`（提交 `4fba522`）；提交作者使用 GitHub 隐私邮箱，不公开个人邮箱。
- [x] 清理后再创建公开仓库：私有信息、WebDesktop 依赖和上游专用文件处理完之前不推送。
- [x] 创建公开仓库，整理可公开源码与许可证。（2026-11-20：`isAlexYoung/ClaudeWeb`）
- [x] 遵守上游 AGPL 附加条款：文档和关于页保留“CloudCLI UI (https://github.com/siteboon/claudecodeui)”署名；明确标注为修改版，不以原版名义发布；宣传中不使用“CloudCLI”“Siteboon”名称。
- [x] 完成命名、认证、用户、文件和终端独立化。（名称、密码登录、claudeweb 用户、文件和终端都已独立）
- [x] 完成浏览器独立运行，去掉 WebDesktop 前置依赖。（2026-11-20：WSL2 Debian 12 浏览器测试通过）
- [x] 在没有 WebDesktop、fa-build 的干净环境完整运行。（2026-11-21 用户在全新 VPS 上验收 2.0.1）

#### 执行进度（2026-11-20）

- 第 1 步删除上游专用文件（`312047f`）；第 2 步 cloudcli→claudeweb 改名并保留署名（`ee565e8`）；第 3 步去掉 WebDesktop 依赖和平台模式（`93b4378`）；第 4 步仓库顶层文件。
- Windows 上的检查：类型检查、lint、构建通过；前端测试全过；后端 18 个失败与基线相同（Windows 路径和符号链接相关），需在 Linux CI 上确认。
- 第 3 步暂未挂载的登录设备列表、新设备提醒、闲置退出、设置 > 关于里的更新和浏览器面板，已在第 5 步改为 ClaudeWeb 自己的实现并重新挂载，文案不再提到 WebDesktop。更新接口返回里仍有旧协议留下的空字段 `webdesktop` 和 `requires_webdesktop`，以后清理。
- 应用内 CLI（`app/server/modules/cli`）与 root 管理命令 `claudeweb` 的关系已定：root 命令是 `packaging/claudeweb`（bash），`claudeweb password` 以 root 身份调用应用内 CLI 的 `password` 子命令；其余应用内子命令只供开发使用。
- 聊天工作目录固定为 `/home/claudeweb`（`CHAT_WORKSPACE_PATH`），安装器须创建该用户及其家目录。
- 服务默认只监听 `127.0.0.1`（`HOST` 可覆盖）。
- 应用版本号 2026-11-21 改为 2.0.0（第一个测试版）。

### 安装更新

- [ ] 发布独立版本，完成默认最新稳定版的一键安装。
- [ ] 设置 → 关于 中完成检查、更新、重连、结果展示和回滚。
- [ ] 验证既有数据、插件和凭据在更新后保留。

### 长期运行

- [ ] 检查最终用户、权限、网络和资源配置。
- [ ] 连续启动关闭终端、浏览器和生成任务，检查遗留进程。
- [ ] 回归中文输入、剪贴板、下载、断线重连和历史恢复。
- [ ] 检查缓存、日志及 inode 增长和维护行为。
- [ ] WSL2 开发回归后，在真实 Debian 12 amd64 VPS 验证安装、重启、网络、图形服务和更新。

### 后续 Claude Desktop

- [ ] 单独设计安装、启动、关闭、显示及数据管理。
- [ ] 入口放在右上角“终端”“文件夹”附近。
- [ ] 优先共用 `claudeweb` 用户，确需拆分时明确共享权限。
- [ ] 不重新引入 WebDesktop 桌面界面。

## 参考实现

- 现有应用：私有 WebDesktop 仓库的 `webdesktop-deploy/cloudcli/app`。
- 安装更新：私有 WebDesktop 仓库的 `webdesktop-deploy/scripts/claudeweb_release.py`。
- 浏览器：私有 WebDesktop 仓库的 `gui-runtime` 及 `server.mjs` 的 ClaudeWeb 浏览器入口。
- 公开安装器：原安装器仓库 fa-build。
- CMCP 连接：CMCP 客户端源码及 WebDesktop 的 `src/lib/cmcp-auth.ts`、`scripts/http-boundary.mjs`。
- 多设备登录：WebDesktop 的 `src/lib/auth.ts`（`desktopLogin`、登录列表、闲置退出）。
- 当前已发布功能基线：ClaudeWeb 1.0.17；正式实施时再次固定提交。

这些路径供提取和比对能力使用，新项目运行时不依赖原目录或仓库。
