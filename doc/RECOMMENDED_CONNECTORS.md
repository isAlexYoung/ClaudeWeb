# 推荐连接器与 VPS 上的 Claude CLI

侧栏“插件”打开独立主页面，复用“设置 → 插件”的安装、筛选、启停、删除和刷新。推荐区展示 Google Drive、Gmail、Google Calendar、Microsoft 365；点击“＋”打开授权说明。

这些推荐项使用 Claude 账户连接器，不是 ClaudeWeb 自定义插件，也不是可以直接用 Git 安装的包。推荐卡片存在不代表已经安装、授权或通过连接测试。ClaudeWeb 当前无法从本地 MCP 配置确认 Claude 账户中的连接器状态，因此不会自动将它们加入“已启用”列表。

VPS 自动打开浏览器失败时，可在添加面板复制明确显示的连接入口，点击“打开内置浏览器”或页面右上角的浏览器按钮，用浏览器粘贴工具传入远程剪贴板，再在地址栏粘贴打开。在该浏览器中登录 Claude 并触发服务授权。页面显示的是官方连接器入口，不是假造的 OAuth 回调链接；如果 CLI 已输出临时授权链接，也可将该链接复制到同一浏览器中打开。

## 通过 Claude 账户使用

1. 在 [Claude 连接器](https://claude.ai/customize/connectors) 中选择对应服务并完成授权。
2. 在 VPS 网页终端运行 `claude`，使用 `/login` 登录同一个 Claude 账户。
3. 在 CLI 中运行 `/mcp` 检查连接器。新建 ClaudeWeb 会话后使用；聊天模式还需要在“设置 → 任务与会话”中开启 MCP，项目模式遵循项目配置。

Claude CLI 和 Agent SDK 支持自动获取该账户的连接器。使用 API Key、第三方 API 提供商、`apiKeyHelper`、Anthropic profile 或 `claude setup-token` 凭据时不会继承。组织的工具和连接器策略仍然生效。

Google Drive、Gmail、Calendar 需要对应的 Google 账户授权。Microsoft 365 的个人账户可用性取决于 Claude 套餐；工作或学校账户可能需要 Microsoft Entra 管理员同意和 Claude 组织启用。

官方来源（核对于 2026-11-24）：

- [Claude Code：使用 claude.ai 的 MCP 服务器](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai)
- [Microsoft 365 连接说明与账户条件](https://support.claude.com/en/articles/15183774-connect-to-microsoft-365)

## 独立 MCP 方式

使用 API Key 的部署可以另外配置兼容的 MCP 服务，但这不是上述账户连接器的免授权替代方式。Google 的 [Workspace MCP 服务](https://developers.google.com/workspace/guides/configure-mcp-servers) 需要自己的 Google Cloud 项目、相关 API、开发者预览权限及 OAuth 设置；Microsoft 的 [Enterprise MCP](https://learn.microsoft.com/en-us/graph/mcp-server/overview) 也有独立的组织与授权要求。完成服务配置后，可通过现有“＋ → MCP”添加。

不要将 Anthropic 托管连接器地址直接写为本地 MCP，期待 CLI 自动完成 OAuth：部分上游服务只接受 Claude 已注册的回调地址，必须在 Claude 网页完成账户授权。
