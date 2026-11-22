# 插件安装实测

2026-11-22，在 Debian 13 amd64 测试 VPS 的 ClaudeWeb 2.0.3 私有验收安装上，通过插件页实际调用的 `/api/plugins/install` 接口，逐个测试当前 9 个推荐项。安装由服务用户 `claudeweb` 执行，使用包内 Node.js 22.23.2。

| 推荐插件 | 版本 | 安装 | 后台服务 | 前端入口 |
| --- | --- | --- | --- | --- |
| 项目统计（project-stats） | 1.0.0 | 成功 | 启动成功 | HTTP 200 |
| 终端（web-terminal） | 1.1.0 | 成功 | 启动失败：无法加载 `node-pty` | HTTP 200 |
| 定时提示（workspace-scheduled-prompts） | — | 失败：仓库无法匿名拉取 | 未验证 | 未验证 |
| PRISM CloudCLI | 1.0.0 | 成功 | 启动成功 | HTTP 200 |
| 会话管理（session-manager） | 1.0.0 | 成功 | 启动成功 | HTTP 200 |
| Token 费用计算器 | 1.0.0 | 成功 | 启动成功 | HTTP 200 |
| 任务队列（task-queue） | 0.13.0 | 成功 | 启动成功 | HTTP 200 |
| GitHub Issues 看板 | 1.10.0 | 成功 | 启动成功 | HTTP 200 |
| Agent Monitor | 0.1.0 | 成功 | 启动成功 | HTTP 200 |

安装成功指仓库拉取、manifest 校验、依赖安装和构建完成；后台启动成功指收到插件的 ready 信号。前端入口检查确认构建资源可以获取。未逐项验证登录外部服务、GitHub 授权、定时任务执行或其他完整业务交互，不能将此表解释为全部功能兼容。

终端插件日志为 `[web-terminal] Cannot load 'node-pty'`，插件自身建议在安装目录执行 `npm install && npm rebuild node-pty`。本轮记录原始失败，没有执行第三方依赖重建，也没有修改其代码；ClaudeWeb 自带的终端是独立功能。

定时提示仓库 `https://github.com/grostim/claudeweb-cron` 返回 Git 认证错误 `PLUGIN_GIT_AUTH_REQUIRED`。无法仅凭匿名拉取失败区分仓库已删除、改名或改为私有，因此没有将它标记为可安装。

每个测试成功安装的插件都在检查后通过卸载接口移除，原有内置额度插件 `claude-usage` 保留。测试未修改用户项目、聊天或 Claude 登录数据。

维护机证据：`E:\WSL\Logs\debian13-plugin-install-results.json`，逐项记录仓库 URL、Git 提交、版本、接口状态、启动结果、入口大小及测试卸载结果。本结论针对该日期和这些提交；第三方仓库后续变化需重新验证。
