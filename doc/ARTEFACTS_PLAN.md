# 作品（Artefacts）动工文件

> 状态：动工中 · 目标版本：2.2.8 · 日期：2026-11-24

本文件说明本次要实现什么、怎么实现、不做什么，作为开发与验收的依据。

## 1. 范围

### 1.1 要做

| 项 | 说明 | 实际功能 |
| --- | --- | --- |
| 左侧栏「作品」入口 | 位于「搜索」与「定时任务」之间；中文「作品」，英文「Artefacts」，繁中「作品」 | ✅ |
| 作品页 | 大标题、搜索 / 筛选 / 视图切换 / 新建四个按钮、「创建新内容」磁贴、作品网格与列表、空状态 | ✅（电子表格以外的类型只有画面） |
| 电子表格 | 新建、打开、编辑（公式、格式、多工作表）、自动保存、重命名、置顶、删除；底部浮动对话框让 Claude 直接改表 | ✅ |
| 其他类型（文档、幻灯片、设计、数据、白板、文件夹、「+」更多） | 出现在磁贴、「+」菜单、筛选里，点击提示「即将推出」 | ❌ 仅画面 |
| Code 模式隐藏「定时任务」 | 左侧栏（展开与收起两种形态）在 Code 模式下不显示定时任务，只在 Chat 模式显示 | ✅ |
| Chat / Code 切换动画 | 模式切换时左侧栏导航与主区域做一次简短的淡入位移过渡 | ✅ |

### 1.2 不做

- 分享、版本历史、评论。
- 所有者 / 「我的」 / 「与您共享」 / 「仅自己可见」等与归属、权限相关的内容：
  - 作品页去掉「全部 / 我的 / 与您共享」标签。
  - 筛选菜单去掉「所有者」「共享」两项。
  - 编辑器顶栏不放「分享」和「版本历史」按钮。
- 文件夹的实际功能、电子表格以外类型的编辑器。
- 作品不纳入本次的备份 / 恢复范围（后续单独评估）。

## 2. 界面

### 2.1 左侧栏

- 展开形态：`新聊天 → 搜索 → 作品 → 定时任务（仅 Chat 模式）→ 插件`。
- 收起形态（图标栏）顺序相同；作品图标使用 `Shapes`（lucide）。
- 作品在 Chat 与 Code 两种模式下都显示。
- 打开作品页与打开定时任务页、插件页互斥（沿用 `WorkspaceExperienceContext.mainPage`，新增取值 `'artefacts'`）。

### 2.2 Chat / Code 切换动画

- 左侧栏导航区（`workspace-navigation` 及上方入口）以 `key={mode}` 重新挂载，播放 180ms 的「淡入 + 向切换方向位移 8px」动画；Chat→Code 从右侧进入，Code→Chat 从左侧进入。
- 模式切换按钮的选中底色以滑块形式在两个按钮间移动（`transform` 过渡）。
- 主区域沿用已有的 `useViewMotion`（其 key 已包含 mode），保证同步过渡。
- `prefers-reduced-motion: reduce` 时关闭位移，只保留瞬时切换。

### 2.3 作品页

```
作品                                              [🔍] [筛选] [视图] [+]
创建新内容
[文档][幻灯片][电子表格 测试版][设计][数据][白板 测试版][+]

（作品网格 / 列表 / 空状态）
```

- **搜索**：点击放大镜展开为输入框（占位「搜索作品…」，右侧 × 清空并收起），按标题过滤。
- **筛选菜单**（二级菜单，复用定时任务页的 `ScheduledTaskMenu` 家族组件，样式一致）：
  - 排序方式：上次打开时间（默认）/ 创建时间 / 名称。
  - 类型：复选框，含各类型数量——文档、幻灯片、电子表格、设计、设计系统、数据、白板、其他。
  - 打开日期：任何时间 / 今天 / 过去 7 天 / 过去 30 天。
  - 已置顶：开关，仅显示置顶作品。
  - 有筛选生效时，筛选图标高亮。
- **视图切换**：网格视图 ⇄ 列表视图；按钮提示文字随状态显示「网格视图」/「列表视图」；选择记在本地偏好。
- **「+」菜单**：对话（开新聊天，实际功能）、文件夹（即将推出）、分隔线、文档、幻灯片、设计、电子表格〔测试版〕、数据、白板〔测试版〕。
- **创建新内容磁贴**：每种类型一个彩色磁贴（图标 + 浅色手绘纹理背景），右上角「…」菜单（新建空白）；电子表格、白板带「测试版」角标；末尾「+」磁贴（更多类型，即将推出）。点击电子表格立即新建并打开编辑器。
- **作品卡片（网格）**：上方类型色缩略图（电子表格为表格示意，文档为文本行示意），右上角「…」与置顶按钮；下方标题与「电子表格 · 7 分钟前」。
- **作品行（列表）**：类型图标、标题、「打开于 7 分钟前」、置顶按钮、「…」。
- **「…」菜单**：打开、重命名、在对话中查看（有关联会话时）、删除（二次确认）。
- **空状态**：三角 / 圆 / 方块线稿插画 +「你的作品都在这里」+「从上方的模板开始，或在任意对话中让 Claude 构建内容。」

### 2.4 电子表格编辑器

在主区域内整页打开（同定时任务页的挂载方式），离开时自动保存。

```
[未命名 ⌄]                                   [显示对话] [×]
fx | 公式栏（FortuneSheet 内置）
网格（FortuneSheet）
        ┌ 浮动对话框：[▦ 未命名 · 电子表格] 描述你需要的电子表格…  [↵] ┐
        └ 浮动格式工具栏：B I U 对齐 文字色 填充色 合并 数字格式 冻结 撤销 重做 | 对话 ┘
[+] [工作表列表] [Sheet1 ⌄]（FortuneSheet 内置工作表标签）
```

- 标题：点击改名；下拉菜单：重命名、下载 CSV（当前工作表）、删除。
- 「显示对话」：右侧抽屉，显示该表关联会话的消息（用户 / Claude 文本，工具调用折叠为一行），运行中自动刷新；底部「在聊天中打开」跳转到完整会话。
- 浮动对话框：发送后 Claude 在该表的专属会话中改表；运行期间表格只读并显示「Claude 正在编辑…」，结束后自动载入新内容。
- 浮动工具栏「对话」按钮切换浮动对话框的显示。
- 不放「分享」「版本历史」。

## 3. 实现

### 3.1 编辑器选型

- **FortuneSheet `@fortune-sheet/react@1.0.4`**，MIT，React 18，自带公式引擎（`@fortune-sheet/formula-parser`）、工作表标签、公式栏与 API（`setCellFormatByRange`、`mergeCells`、`freeze`、`getAllSheets`、`handleUndo` 等）。
- 关闭其自带工具栏（`showToolbar: false`），用我们自己的浮动工具栏调用其 API，保持 ClaudeWeb 视觉。
- `lang` 跟随界面语言（zh / zh_tw / en）；Claude 运行期间表格上盖一层透明遮罩，只读。
- 公式计算：1.0.4 的 `forceCalculation` 选项实际未被使用，载入的数据不会自动算公式；且它自带的整表重算按行顺序进行，引用下方公式的单元格（如 `C3=B3/B$8`、`B8=SUM(...)`）会先得到错误并丢失数字格式。因此编辑器在每次挂载表格后，按依赖顺序（`formulaOrder`：解析同表 A1 引用、拓扑排序、遇环即断）逐个调用 `calculateFormula(sheetId, range)`，最后再整本重算一遍以覆盖跨表引用。
- 数字与公式单元格默认右对齐（FortuneSheet 默认左对齐）；这个对齐只在载入时加上，保存时不写回文件。
- 编辑器代码与样式按路由懒加载（`React.lazy`），不进入主包。

### 3.2 文件格式（Claude 可直接读写）

每个电子表格是磁盘上的一个 JSON 文件 `*.sheet.json`，以 A1 地址为键，便于 Claude 用 Read / Edit 工具直接修改：

```json
{
  "format": "claudeweb-sheet@1",
  "sheets": [
    {
      "name": "Sheet1",
      "cells": { "A1": "项目", "B1": "金额", "A2": "房租", "B2": 3200, "B4": "=SUM(B2:B3)" },
      "styles": { "A1": { "bold": true, "bg": "#E8F0FE" }, "B4": { "format": "0.00" } },
      "merges": ["A6:C6"],
      "colWidths": { "A": 140 },
      "rowHeights": { "1": 28 },
      "frozen": { "rows": 1, "cols": 0 }
    }
  ]
}
```

- 单元格值：数字、字符串、布尔；以 `=` 开头的字符串是公式。
- 样式键：`bold`、`italic`、`underline`、`color`、`bg`、`align`（left / center / right）、`valign`、`fontSize`、`format`（数字格式，如 `0.00`、`0%`、`yyyy-mm-dd`）。
- 与 FortuneSheet 数据的双向转换放在 `src/modules/artefacts/sheet/sheetFormat.ts`，有单元测试覆盖。
- 服务器校验：根对象、`format`、`sheets` 数组、每个工作表的 `name` 与 `cells`；文件上限 5 MB。

### 3.3 存储

- 文件：`<服务账户主目录>/Artefacts/<id>.sheet.json`。VPS 上即 `/home/claudeweb/Artefacts/`，位于 Chat 工作区内，Claude 在 acceptEdits 模式下可直接编辑。
- 数据库新表（`migrations.ts` 只新增表，不改动现有表）：

```sql
CREATE TABLE IF NOT EXISTS artefacts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- sheet（目前唯一实际可建的类型）
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  session_id TEXT,               -- 关联的对话，首次让 Claude 改表时创建
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  opened_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- 版本号 `revision` = 文件 `mtimeMs` 与大小组合，用于检测 Claude 或用户的改动。

### 3.4 API（`/api/artefacts`，需登录）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/` | 列表（不含内容） |
| POST | `/` | 新建 `{ kind: 'sheet', title? }`，写入空白表 |
| GET | `/:id` | 元数据 + 内容 + revision，并记录打开时间 |
| PUT | `/:id/content` | 保存 `{ content, baseRevision }`；文件已被改动则 409 |
| PATCH | `/:id` | 改名、置顶 |
| DELETE | `/:id` | 删除记录与文件 |
| GET | `/:id/state` | `{ revision, running, sessionId }`，编辑器轮询用 |
| POST | `/:id/messages` | `{ text }`：让 Claude 改表，返回 `{ sessionId }`（202） |

### 3.5 让 Claude 改表

1. 首次发送时，服务器在 Chat 工作区创建一个应用会话（标题「电子表格：<标题>」），写入 `artefacts.session_id`；之后的消息继续使用该会话（保留上下文）。
2. 通过与定时任务相同的 `runDetachedChatTurn` 启动一轮对话：
   - 选项为 `permissionMode: 'acceptEdits'`、`unattended: true`。
   - 新增 `systemPromptAppend`：写入文件的绝对路径、`claudeweb-sheet@1` 格式说明，以及「只修改该文件、保持合法 JSON」的要求。
   - Claude 运行时在 `mapCliOptionsToSDK` 中把它追加到系统提示末尾，只对这类运行生效。
3. 不等待运行结束，接口立即返回 202。
4. 编辑器每 1.5 秒轮询 `/state`：
   - 运行中：表格只读，并显示进度。
   - revision 变化或运行结束：重新载入内容。
5. 失败（运行未启动、文件被改成非法 JSON）时在对话框上方提示，表格保留上次的合法内容。

### 3.6 用户编辑保存

- FortuneSheet `onChange` → 防抖 800ms → `PUT /content`，携带 `baseRevision`。
- 返回 409（期间文件被 Claude 改过）：载入服务器版本，并提示「表格已被更新，已载入最新内容」。
- 离开编辑器或切换页面前立即保存一次。

### 3.7 前端模块

- `src/modules/artefacts/`（新模块，通过 `index.ts` 对外导出）：
  - `ArtefactsPage.tsx`、`ArtefactCreateTiles.tsx`、`ArtefactGrid.tsx`、`ArtefactMenus.tsx`、`useArtefacts.ts`。
  - `sheet/SpreadsheetEditor.tsx`（懒加载）、`sheet/SheetToolbar.tsx`、`sheet/SheetComposer.tsx`、`sheet/SheetConversation.tsx`、`sheet/sheetFormat.ts`。
- `WorkspaceExperienceContext`：`mainPage` 增加 `'artefacts'`，并新增 `openArtefacts`、`openArtefact(id)`、`closeArtefact`。
- `WorkspaceMain`：作品页 / 编辑器的挂载分支。
- `IntegratedSidebar`：作品入口、Code 模式隐藏定时任务、模式切换动画。
- 样式写入 `workspace-theme.css`，配色用主题变量，适配 warm / light / dark。
- 文案：en、zh-CN、zh-TW 三种语言。

### 3.8 后端模块

- `server/modules/artefacts/`：
  - `artefacts.routes.ts`、`services/artefacts.service.ts`（文件读写、校验、revision）、`services/artefact-runs.service.ts`（会话与运行）、`sheet-format.ts`（格式校验与系统提示文本）、`index.ts`。
- `server/modules/database/repositories/artefacts.db.ts` + schema / migration。
- `server/index.ts` 挂载路由，并把 provider runtime 交给运行服务。

## 4. 测试与验收

- 服务端：仓储与服务（新建 / 保存 / 409 冲突 / 删除连同文件 / 校验非法内容）、`systemPromptAppend` 生效、消息接口创建并复用会话。
- 前端：格式双向转换（值、公式、样式、合并、列宽、冻结）、作品页筛选 / 排序 / 搜索 / 视图切换、「即将推出」类型、侧边栏 Code 模式不显示定时任务、编辑器保存与只读状态。
- 视觉：无头浏览器截图核对作品页（网格、列表、菜单、空状态）与编辑器，覆盖 warm / dark 主题。
- 全量：typecheck、lint（无新增警告）、全部前端测试、服务端相关测试、前端构建。

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| FortuneSheet 体积较大 | 懒加载，只在打开表格时下载 |
| FortuneSheet 样式影响全局 | 样式随编辑器加载；必要时在容器内覆盖 |
| Claude 写出非法 JSON | 服务器读时校验，编辑器保留上次合法内容并提示；系统提示要求先 Read 后 Edit |
| 用户与 Claude 同时修改 | Claude 运行期间只读；保存带 baseRevision，冲突以服务器版本为准 |
