# 作品：文档与白板 — 动工文件

> 基线版本：2.3.3（`eeb194f`）。目标版本：2.3.4。
> 前置文档：`doc/ARTEFACTS_PLAN.md`（电子表格）。本文只写新增与改动。

## 1. 要做什么

在「作品」里把 **文档** 和 **白板** 从「即将推出」变成可用，交互、动画与 2.3.3 的电子表格完全一致：

| 能力 | 电子表格（现状） | 文档 | 白板 |
|---|---|---|---|
| 新建（磁贴 / + 菜单 / 磁贴「新建空白」） | ✅ | ✅ | ✅ |
| 新建即建专属会话，侧栏显示作品图标、改名同步 | ✅ | ✅ | ✅ |
| 打开：左编辑器 + 右侧真实 Chat 分屏，滑动展开 / 收起 | ✅ | ✅ | ✅ |
| 右上角：斜箭头切换对话面板、× 最小化回会话 | ✅ | ✅ | ✅ |
| 会话顶部卡片、向下滚动时收进标题栏的小胶囊 | ✅ | ✅ | ✅ |
| 底部浮动对话框（作品名 + 类型标签）+ 浮动工具栏 | ✅ | ✅ | ✅（工具栏为白板自带） |
| 空对话：手绘插图 + 3 个建议按钮（只填入、不发送） | ✅ | ✅ | ✅ |
| Claude 编辑时只读、改完自动刷新；自己的修改 800ms 自动保存 | ✅ | ✅ | ✅ |
| 保存冲突（409）以 Claude 的版本为准并提示 | ✅ | ✅ | ✅ |
| 标题菜单：重命名 / 下载 / 删除 | CSV | Markdown（.md） | PNG、.excalidraw |
| 会话卡片上的下载按钮 | CSV | .md | .excalidraw |
| 深色模式 | 画布仍为浅色（已知限制） | ✅ | ✅（Excalidraw 原生深色） |

不做：幻灯片、设计、数据（仍为「即将推出」）；多人协作；图片上传到文档（白板可粘贴图片，存进文件）。

## 2. 选型

| 类型 | 编辑器 | 许可证 | 文件（Claude 直接读写） |
|---|---|---|---|
| 文档 | Tiptap 3.35（`@tiptap/react`、`starter-kit`、官方 `@tiptap/markdown`、`extension-table`、`extension-list`、`extension-image`、`extensions`） | MIT | `~/Artefacts/<id>.md`（GFM Markdown） |
| 白板 | Excalidraw 0.18.1（`@excalidraw/excalidraw`） | MIT | `~/Artefacts/<id>.excalidraw`（Excalidraw 官方 JSON） |

- 不选 tldraw（自定义许可证，商用需付费 / 水印）；不选 BlockNote（部分扩展 GPL / 商业）。
- 两个编辑器都按需懒加载（`React.lazy`），不进主包。

## 3. 文件格式与 Claude 的编辑说明

### 3.1 文档：`claudeweb` 直接用 Markdown

- 文件就是 Markdown 文本，无包装。Claude 用 Read / Edit 直接改。
- 支持：标题 1–3 级、段落、粗体、斜体、删除线、行内代码、链接、无序 / 有序列表、任务列表（`- [ ]`）、引用、代码块、分隔线、表格（GFM）、图片（URL）。
- 编辑器载入用 `contentType: 'markdown'`，保存用 `editor.getMarkdown()`。
- 只在用户真的改动时保存：载入用 `emitUpdate: false`，切换只读用 `setEditable(editable, false)`（Tiptap 默认会触发 `onUpdate`，曾导致一打开文档就保存一次），所以 Claude 写的 Markdown 风格不会被无谓改写。
- 上限 2 MB。

### 3.2 白板：Excalidraw JSON，允许「简写元素」

文件结构（Excalidraw 官方格式，可在 excalidraw.com 打开）：

```json
{ "type": "excalidraw", "version": 2, "source": "claudeweb",
  "elements": [ ... ], "appState": { "viewBackgroundColor": "#ffffff" }, "files": {} }
```

Claude 手写完整 Excalidraw 元素（几十个字段、seed、version）容易出错，所以允许 **简写元素**（Excalidraw 官方 `ExcalidrawElementSkeleton`）：

```json
{ "type": "rectangle", "id": "start", "x": 0, "y": 0, "width": 180, "height": 70,
  "backgroundColor": "#d0ebff", "label": { "text": "开始" } }
{ "type": "arrow", "start": { "id": "start" }, "end": { "id": "next" }, "label": { "text": "是" } }
{ "type": "text", "x": 0, "y": 120, "text": "说明文字", "fontSize": 20 }
```

- 载入时：有 `version` 与 `versionNonce` 的视为完整元素，其余用 `convertToExcalidrawElements` 转成完整元素（保留 Claude 给的 id，箭头可按 id 绑定形状）；全部再过 `restoreElements` 补齐缺省字段。
- 箭头走线：`convertToExcalidrawElements` 只记录绑定，不按形状计算走线（没有 points 时默认向右 100px）。所以转换前由 `routeSkeletonArrows` 处理：两端都按 id 找到形状（简写或完整元素均可）且没给 points 的箭头 / 线，从一个形状的边缘画到另一个的边缘（矩形、椭圆、菱形分别求交点，两端各留 6px）。Claude 只需写 start / end 的 id，不必算坐标。
- 框架裁剪：Excalidraw 会把绑定到框架内形状的箭头归入该框架，越出框架的部分被裁掉。转换后由 `releaseCrossingArrows` 把两端不在同一框架里的箭头（及其标签文字）移出框架。
- 用户一旦编辑，保存回的就是完整元素；Claude 修改已有元素时改其字段（位置、文字、颜色）即可，删除时去掉它或设 `"isDeleted": true`。
- 上限 10 MB（白板可能含粘贴的图片）。
- 服务端校验：JSON 对象、`type === "excalidraw"`、`elements` 为数组、每个元素有字符串 `type`。

## 4. 服务端改动

- 新增 `server/modules/artefacts/formats/`：每种类型一个格式描述
  `{ kind, extension, maxBytes, blank(), parse(text) → {content|error}, serialize(content) → text, validate(content), instructions(filePath, title) }`
  - `sheet`：从现有 `sheet-format.ts` 平移，行为不变。
  - `doc`：Markdown 文本。
  - `whiteboard`：Excalidraw JSON。
- `artefacts.service.ts` 全部经由格式描述读写：`create` 接受 `sheet | doc | whiteboard`；`open` / `saveContent` 按类型解析与校验；`sendMessage` 与 `resolveArtefactTurnContext`（Chat 里直接发消息也改作品）按类型给 Claude 附加编辑说明。
- `ArtefactKind`（数据库层类型）扩到三种；表结构不变（`kind` 本就是 TEXT，无需迁移）。
- revision、409、只读期间拒绝保存（`ARTEFACT_BUSY`）、专属会话、改名同步等逻辑全部复用。

## 5. 前端改动

### 5.1 共用部分（保证三种编辑器交互一致）

- `useArtefactFileSync(artefactId, { serialize, onLoaded })`：从电子表格编辑器抽出的通用逻辑 — 打开、自动保存（800ms）、409 以 Claude 版本为准、轮询（运行中 1.5s / 空闲 4s）、右侧 Chat 跑完立即刷新、发送（优先走右侧真实 Chat，失败回退 API）、改名、删除、最小化、建议填入。
- `ArtefactEditorFrame`：顶部栏（标题菜单、保存状态、斜箭头、×）+ 主体 + 底部浮动区（提示条、对话框、工具栏插槽）+ 非分屏时的对话抽屉。沿用现有 `sheet-editor-*` / `sheet-composer` / `sheet-toolbar` 样式类，外观与电子表格一致。
- 电子表格编辑器本次**不重构**（避免回归），新编辑器复刻同样的结构与类名。

### 5.2 分发

- `ArtefactEditor`：WorkspaceMain 分屏左侧渲染它；按作品类型选择 `SpreadsheetEditor` / `DocumentEditor` / `WhiteboardEditor`（类型取自已缓存的作品列表，取不到时读一次作品详情）。
- 分屏右侧 Chat 的空状态、底部输入框占位文字、会话卡片的下载动作都按类型切换。

### 5.3 文档编辑器

- 版面：居中纸面列（最大 760px），标题 / 正文排版与 Chat 字体一致；空文档显示占位提示。
- 浮动工具栏（与表格相同样式）：段落 / 标题 1–3 下拉、粗体、斜体、删除线、行内代码、无序 / 有序 / 任务列表、引用、代码块、链接、插入表格、分隔线、撤销、重做、「对话」开关。
- Claude 运行中 `setEditable(false)`；Claude 改完以新内容 `setContent`（不触发保存），并尽量保留滚动位置。

### 5.4 白板编辑器

- Excalidraw 自带顶部绘图工具栏，保留；隐藏「打开文件 / 保存到文件 / 切换主题」等与我们重复的菜单项。主题跟随 ClaudeWeb 深浅色，语言跟随界面（zh-CN / zh-TW / en）。
- 底部浮动对话框与表格一致；白板不另加格式工具栏，只放「对话」开关。
- Claude 运行中 `viewModeEnabled`（只读，可平移缩放）；Claude 改完用 `updateScene` 换内容，**保留当前视口**。
- 保存：`onChange` 很频繁，先比较 `getSceneVersion` 与背景色，变了才序列化并延迟 800ms 保存。
- 字体自托管：Vite 插件在开发时提供、构建时把 `@excalidraw/excalidraw/dist/prod/fonts` 复制到 `dist/excalidraw-assets/fonts`，并设置 `window.EXCALIDRAW_ASSET_PATH`（遵循 `VITE_BASE_PATH`）。不依赖 esm.sh CDN。

### 5.5 作品页

- `doc`、`whiteboard` 标为可用；创建走同一个 `createArtefact(kind)`。
- 卡片预览：文档为纸面文字行（已有），白板为手绘形状草图。

## 6. 测试

- 服务端：三种类型的创建 / 打开 / 保存 / 校验 / 409 / 编辑说明；Chat 直接发消息时按类型附加说明。
- 前端：白板简写元素转换与序列化；文档 Markdown 读写；作品页新建文档 / 白板并打开；分发组件按类型渲染；会话卡片按类型下载；侧边栏不受影响。
- 全量 vitest、类型检查、lint、构建；浏览器截图核对：文档 / 白板的浅色、深色、Claude 编辑中、分屏与最小化卡片。

## 7. 风险

- Excalidraw 包较大（约 2.8 MB JS + 字体 12.5 MB，按需加载，字体按字符分片按需下载）。
- Markdown 往返：Tiptap 不支持的 Markdown（脚注、HTML 块）在用户编辑后会被规范化；Claude 写入的内容在用户未编辑前不会被改写。
- 白板简写元素若写错（例如箭头绑定不存在的 id），转换会忽略该绑定而不是丢弃整份文件；某个简写元素转换失败时逐个重试，只丢弃那一个。
