# 设置说明

本文记录设置的用途、保存文件，以及从界面移出的技术说明。一般使用网页设置即可。
安装和更新方法见[使用指南](USER_GUIDE.zh-CN.md)。

## 路径约定

标准 Linux 安装以 `claudeweb` 用户运行，主目录为 `/home/claudeweb`。
下文 `~` 指服务用户的主目录，不是 SSH 登录的 root 主目录。
标准安装的数据库为 **`/var/lib/claudeweb/auth.db`**，由
`/etc/claudeweb/claudeweb.env` 中的 `DATABASE_PATH` 指定；开发运行通常使用
`~/.claudeweb/auth.db`，以实际环境配置为准。

“您的 Claude”默认读写 `~/.claude`；设置了绝对路径 `CLAUDE_CONFIG_DIR` 时使用该目录。
MCP 和技能管理目前仍使用下表列出的各自路径，不会随这个环境变量自动迁移。

## 设置与保存位置

| 分类 / 设置 | 保存位置及用途 |
| --- | --- |
| 账户：名称、头像 | `auth.db` 的 `user_preferences` 表，`workspaceProfile`；用于网页个人资料。 |
| 账户：Claude 应该如何称呼你 | `~/.claude/CLAUDE.md` 中由 ClaudeWeb 管理的称呼区块；保留文件其他内容。 |
| 额度 | 显示 Claude 使用情况；不是修改套餐或创建额度的配置。 |
| 外观：主题、语言 | `auth.db` 的 `user_preferences`，分别为 `theme`、`userLanguage`。默认暖白；选择跟随系统后才跟随系统明暗。 |
| 外观：界面字体、回复字体、阅读设置 | 同表的 `workspaceFonts`、`transcriptAppearance`。中文使用系统字体。 |
| 外观：编辑器设置、项目排序 | 同表的 `codeEditorSettings`、`projectSortOrder`。 |
| 您的 Claude：回复风格 | Claude 配置目录的 `settings.json`，键 `outputStyle`；自定义风格位于 `output-styles/*.md`。 |
| 您的 Claude：自动记忆、记忆目录、后台整理 | 同一个 `settings.json` 中的 `autoMemoryEnabled`、`autoMemoryDirectory`、`autoDreamEnabled`；缺失的键交给 Claude 默认处理。 |
| 通知：渠道、声音、事件类型 | `auth.db` 的 `user_notification_preferences` 表。浏览器通知授权由浏览器管理；推送订阅端点另存数据库。 |
| 插件：自定义网页插件 | `~/.claude-code-ui/plugins/<插件名>/`；注册信息、启用状态和背景槽位归属在 `~/.claude-code-ui/plugins.json`；插件持久化数据在 `~/.claude-code-ui/plugin-data/<插件名>/`；登录页外观快照在 `~/.claude-code-ui/public-appearance/`。 |
| 插件：MCP 用户范围 | `~/.claude.json` 的 `mcpServers`。 |
| 插件：MCP 项目范围 | 项目根目录的 `.mcp.json`，键 `mcpServers`。 |
| 插件：MCP 本地项目范围 | `~/.claude.json` 的 `projects[项目绝对路径].mcpServers`。 |
| 任务与会话：聊天模式 MCP 开关 | `auth.db` 的 `user_preferences.uiPreferences.chatMcpEnabled`；项目模式按项目配置读取。 |
| 插件：添加全局技能 | `~/.claude/skills/<技能名>/SKILL.md`；同目录可包含脚本、参考资料和资源。链接添加和上传使用同一个安装器。 |
| 插件：项目技能 | 项目根目录的 `.claude/skills/<技能名>/SKILL.md`。 |
| 插件：Claude CLI 插件附带的技能 | 根据 `~/.claude/settings.json` 的 `enabledPlugins` 和 `~/.claude/plugins/installed_plugins.json` 的安装路径发现，与网页自定义插件分别管理。 |
| 任务与会话：任务集成、对话建议、改动汇总等 | `auth.db` 的 `user_preferences`，包括 `tasksEnabled`、`uiPreferences`。 |
| 任务与会话：跳过权限提示 | 同表的 `claudePermissions.skipPermissions`，控制 Claude 运行时权限模式。 |
| 任务与会话：自动归档 | 同表的 `autoArchiveInactiveDays`；归档状态在会话数据库中，不会删除会话文件。 |
| 备份与恢复 | 导出、导入操作；备份范围、恢复预览及冲突处理以页面显示为准。 |
| 关于：检查更新 | 读取已安装版本和经过签名验证的发行列表；点击更新后才执行，不会定时自动升级。 |

浏览器 `localStorage` 的 `user-preferences` 是界面偏好的镜像，登录后以服务端同步为准。
退出登录会清除私人设置镜像，但保留不含个人信息的 `appearance-theme`，让登录页和密码验证后的
加载页继续使用此浏览器最后选择的主题。新浏览器默认暖白，登录后再同步服务端偏好。

## 从界面移出的说明

- **称呼**：保存在用户级 `CLAUDE.md` 中。使用同一 Claude 配置目录的网页对话、网页终端和
  SSH Claude 会话均可读取，从后续消息或新加载配置的会话开始使用。账户“名称”只改变网页个人资料。
- **回复风格**：决定 Claude 如何组织回复。`outputStyle` 与 CLI 的 `/output-style` 使用同一个设置；
  自定义风格放在 `output-styles/` 中，从后续消息开始生效。
- **记忆**：这些开关与 CLI `/memory` 页面使用同一个 `settings.json`。
  记忆目录留空时默认使用 `~/.claude/projects/<项目>/memory/`；自定义目录应填写绝对路径或 `~/` 开头的路径。
  后台整理在空闲时合并、整理记忆，可能消耗套餐额度；未设置时由 Claude 决定。
- **权限**：“跳过权限提示”等同于 CLI `--dangerously-skip-permissions` 对应的运行模式。
  旧的“允许的工具”“禁用的工具”编辑器已删除，已有 `claudePermissions.allowedTools`、
  `claudePermissions.disallowedTools` 数据仍保留并用于运行时。
- **来自 Claude 设置文件的权限规则**：用户级 `settings.json` 的 `permissions.allow`、
  `permissions.deny`、`permissions.ask` 仍生效。Linux 管理员规则在
  `/etc/claude-code/managed-settings.json`。旧的只读规则展示已移除，没有删除或改写文件。
  缺失文件不会添加规则，无效 JSON 应先修复。项目的 `.claude/settings.json`、
  `.claude/settings.local.json` 也用于项目聊天；项目未被 CLI 信任前，项目允许规则可能不被采用。
  可在该目录以交互方式运行 Claude 并接受信任提示。
- **自定义插件**：当前为受信任代码模型，插件代码在网页上下文和服务器 `claudeweb` 账户下执行，安装前应审查来源或确认作者可信。若第三方插件异常影响界面，可在网址后加 `?safe-plugins=1` 进入安全模式，或在服务器执行 `sudo claudeweb plugins --disable-all` 紧急停用全部第三方插件。格式与开发方法见[自定义插件说明](CUSTOM_PLUGINS.md)。

## 插件、MCP 与技能刷新

插件页使用搜索栏、“全部 / 连接器 / Skills”筛选，以及独立的“＋”安装页。
列表只显示“已启用”和“未启用”两组，每组依次列出自定义插件、MCP 和 Skills；没有项目的分类不显示占位提示。卡片标明类型，有设置面板的插件才显示“打开面板”。启停成功后卡片带过渡动画移动，遵循系统的减弱动态效果偏好。

MCP 停用时保留原配置与凭证，定义从原作用范围的 `mcpServers` 移到同级 `claudewebDisabledMcpServers`；启用时还原。技能停用时将入口文件重命名为 `SKILL.md.disabled`（插件附带的命令为 `.md.disabled`），保留同目录的支持文件，启用时恢复原名。停用的技能只进入管理列表，不进入运行时技能发现结果。

插件页右上角“刷新”同时刷新三类列表，等待期间保留原列表。
MCP 没有定时轮询。进入页面、项目范围变化，以及添加、编辑、删除服务器后会重新读取；
MCP 普通读取有 30 秒缓存，技能普通读取有五分钟缓存；点击“刷新”会绕过缓存。

## 通过链接添加技能

在“插件 → ＋ → Skills”输入链接，点击“添加”。支持公开 GitHub 仓库、
`tree/<分支或版本>/<技能目录>`、`blob/<分支或版本>/<技能目录>/SKILL.md`
及 `raw.githubusercontent.com` 的 SKILL.md 链接。包含 `/` 的分支名可在分支段用 `%2F` 编码。
仓库链接会发现其中的技能；仓库过大时请提供具体技能目录或上传文件夹。

下载固定到同一提交，保留技能目录中的普通文件，不运行仓库脚本。
一次最多 20 个技能、500 个文件，单文件最多 2 MiB、文件总量最多 20 MiB；不接受符号链接或子模块。
公共 GitHub 下载可能受速率限制，可稍后重试或使用文件夹上传。
与上传相同，同名技能会替换原技能目录。其他 Git 托管站点或私有仓库可先下载后上传。
