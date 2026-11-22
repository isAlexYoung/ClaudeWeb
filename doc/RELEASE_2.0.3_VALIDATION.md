# 2.0.3 测试版验证记录

日期：2026-11-22。发布地址：[v2.0.3 测试版](https://github.com/isAlexYoung/ClaudeWeb/releases/tag/v2.0.3)。

- 源码提交：`cb2cba9261b302e7e3a489e695317fb494a0c48e`。
- 安装包：`claudeweb-2.0.3-linux-x64.tar.xz`，68,872,760 字节。
- SHA-256：`50f87b89c1325227706c4a6e6fa259499a766d16f66360ba37f379695d2f5c3e`。
- GitHub 标记为 prerelease，签名清单的 channel 为 `test`，没有提升为正式版。
- 由 Ubuntu 22.04 amd64 构建；包内 SQLite、bcrypt、PTY 实际运行检查通过。

## Ubuntu 22.04 真实 VPS

使用用户重装的 Ubuntu 22.04.1 LTS amd64、systemd、glibc 2.35、2 核约 2 GiB 内存的测试服务器；连接信息和凭据不进入仓库。

候选包的基础与图形检查 37 项通过：普通用户服务、仅 localhost 监听、IPv6 禁用、密码权限及日志保护、15 阶段输出与欢迎横幅、CLI、原生模块、API 认证、浏览器画面和剪贴板、Desktop 启动中取消、真实画面、最小化保留、关闭清理 200 个测试缓存文件、配置与钥匙串保留、重开及图形进程回收。另通过实际网页的 Desktop 画面、最小化橙点、恢复、全屏和关闭检查。官方 Desktop 实测版本为 6.28899.6。

首次实机检查发现 `mkswap -q` 不受 Jammy util-linux 支持。修复为通过重定向隐藏输出，重新构建最终包，并在 VM 安装检查中新增实际 swap 断言；VPS 已启用约 2 GiB swap。服务未配置额外 CPU、内存或进程数量配额。

发布后从公开安装器、公开签名清单和 GitHub Release 下载最终包重新安装，安装器退出 0、服务启动通过；最终包的基础与图形检查再次 37 项通过，公开清单的更新检查通过。替换了发布前的本地候选目录，保留用户、数据库、项目、密码和配置；没有复用候选包目录冒充最终包验证。

## 自动检查

- 发布前平台与安装输出检查 17 项通过；后端测试 866 项通过、1 项跳过。
- [发布提交 CI](https://github.com/isAlexYoung/ClaudeWeb/actions/runs/44986272642) 全部通过：应用检查、测试包构建，以及 Debian 12 / Ubuntu 22.04 各五项安装、更新回滚、浏览器、设备和 sudo 检查，共 12 个任务。
- 公开发行验证通过：[Ubuntu 22.04 初装](https://github.com/isAlexYoung/ClaudeWeb/actions/runs/44986715155)，以及 [Debian 12 从 2.0.2 更新至 2.0.3](https://github.com/isAlexYoung/ClaudeWeb/actions/runs/44986711301)。

## 待验收

真实 Claude 账号登录和生成、完整终端交互、真实 Cloudflare 域名、重启恢复及长时间运行未完成，不因图形画面和进程检查通过而视为通过。其他三个新增发行版尚未放行。

后续按用户要求优先在真实 VPS 迭代和测试，减少 WSL 的重复安装与依赖下载；本轮发行构建结束后已停止本次启动的 WSL 环境。
