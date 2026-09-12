# 前端：多面板 / 多标签页 / 多选拖拽 设计方案

> 状态：**方案搁置（暂不实现）**。产品侧已决定不做多面板模式，因此本文只作为设计参考保留，
> 第 9 节的分阶段计划**没有执行**；`ExplorerTabBar` / `ExplorerLayout` / pane 注册表等新文件都不存在。
> 其中「多选拖拽」与多面板无关，如果之后要做，第 7 节的协议仍然有效，
> 但拖拽落地时必须调用 `createTask`（见 [`../async-file-operations-ws-design.md`](../async-file-operations-ws-design.md)）而不是旧的复制粘贴接口。
>
> 目标形态参考 Total Commander（双面板 + F5/F6 快捷键）与 Q-Dir（2~4 宫格）。

## 1. 现状梳理

### 1.1 组件与状态归属

| 文件 | 现职责 | 状态归属 |
| --- | --- | --- |
| `views/FileLite.vue` | 路由页 `/`，渲染一个 `FileManager` + `AppsEntry` | — |
| `views/FileManager/FileSelector.vue` | 用 `ViewPortWindow` 包一个 `FileManager`，用于选文件/文件夹 | 单实例 |
| `views/FileManager/FileManager.vue` | **外壳**（header 工具栏、AddressBar、FilterBar、FileSidebar、`el-splitter`）+ 调 `useNavigation` | 导航、filter 在组件内；通过 `fileListRef` 命令式调用 FileList |
| `views/FileManager/ExplorerUI/FileList.vue` | 列表/网格渲染、排序、过滤、选择、剪贴板、上传下载、右键菜单、虚拟滚动、滚动位置、`TransferQueue` | **列表状态几乎全部在这一层** |
| `ExplorerUI/hooks/use-navigation.ts` | 路径 + 文件列表 + 历史 + 刷新 | `basePath` 用 `useStorage(LsKeys.NAV_PATH)` —— **全局单例** |
| `ExplorerUI/hooks/use-selection.ts` | 框选、Ctrl/Shift 选择、全选 | `Set<IEntry>` + 以 name 为键的集合 |
| `ExplorerUI/hooks/use-copy-paste.ts` | 剪切/复制/粘贴 | `useSharedRef` + BroadcastChannel，**天然跨面板/跨浏览器标签页** |
| `ExplorerUI/explorer-state.ts` | 按 path 持久化 `position` / `sortMode` | localStorage，按路径为键 |
| `hooks/use-shortcut.ts` | 全局 keydown 分发 | scope 取自 `event.target` 最近的 `[data-shortcut-scope]`，**同 scope 只触发第一个注册项** |
| `utils/bus.ts` | mitt：`REFRESH` / `SELECT_COLLECTED` / `REVEAL_ITEM` | 进程内全局 |

### 1.2 与目标形态直接冲突的点

1. **`basePath` 是全局单例**：`use-navigation.ts:14` 的 `useStorage(LsKeys.NAV_PATH)` 让所有 `useNavigation()` 实例共享同一个路径，第二个面板会跟着第一个面板跑。
2. **快捷键无法区分面板**：`use-shortcut.ts:149-183` 解析出唯一 scope，然后在 `registrationsByScope` 里取**第一个命中**的注册。两个面板都 `provide('fileManager')` 时，按键只会落到注册顺序靠前的那个面板。
3. **没有可复用的"单个列表"状态单元**：`FileManager.vue` 把外壳与列表揉在一起，`FileList.vue` 既渲染又持有全部状态，面板/标签页缺少可挂载/保活的边界。
4. **"New Tab" 名不副实**：`FileManager.vue:195 openPathInNewTab()` 是 `window.open` 浏览器标签页，不是应用内标签页。
5. **视图偏好在全局**：`isGridView` / `iconSizeList` / `iconSizeGrid` / `showHidden` 存在 `localSettingsStore`（`store/index.ts:47-64`），多面板会联动。
6. **`TransferQueue` 每个 FileList 一个**：多面板会产生 N 个传输窗口/队列。
7. **框选与原生拖拽冲突**：`use-selection.ts:163 handleContentMouseDown` 绑在 `.explorer-content` 上，`canStartSelectionDrag`（:422）只排除了 `a/input/textarea/select/.resizer/.checkbox*`，**没有排除行本身**，所以在行上按下拖动会发起框选。
8. **选择以 name 为键**：`use-selection.ts:31-32` 的 `Set<IEntry>` + `Set<string>` 只在本目录内成立；拖拽需要绝对路径，而 `selectedPaths` 目前没有通过 `defineExpose` 暴露（`FileList.vue:733-742`）。

### 1.3 可以直接复用的既有能力

- **剪贴板已经是跨面板/跨窗口的**：`use-copy-paste.ts` 的 `useSharedRef` 在同一文档内是同一个 `ref`，`moveRefresh` 机制可被拖拽移动直接复用（源面板自动刷新）。
- **后端已支持批量复制/移动**：`fsWebApi.copyPaste({ fromPaths, toPath, isMove })`（`api/filesystem.ts:52`）。
- **选择框、虚拟滚动、缩略图管线**都已独立成 hook，可原样放进面板。
- **`ThemedIcon` 用 IntersectionObserver 控制预览加载**（`ThemedIcon.vue:170`）。`v-show` 隐藏的标签页 `display:none` → 不进入视口 → **天然不会发预览请求**，无需额外改造。

---

## 2. 目标与范围

### 2.1 目标

- **多面板**：单面板 / 左右双面板 / 上下双面板 / 四宫格，可拖动分隔条调整比例；任意时刻只有一个"活动面板"。
- **多标签页**：每个面板独立标签栏，支持新建/关闭/拖拽排序/快捷切换；标签页各自的路径、历史、选择、滚动位置互相独立。
- **多选拖拽**：把当前选择（多选）拖到文件夹行、面板空白处、另一个面板、面包屑、标签页上完成移动/复制；拖拽默认移动，Ctrl 复制。
- **选择器模式不受影响**：`FileSelector` 仍是单面板、单标签，`handleSelect` 契约不变。

### 2.2 非目标（本期不做）

- 重写后端；拖拽不引入分片/进度协议（沿用 `copy-paste` 单请求）。
- 跨浏览器窗口拖拽（DnD 本身不支持；跨窗口仍走已有的共享剪贴板 + 粘贴）。
- 标签页跨面板拖动（可作为后续增量）。
- 移动端多面板（移动端强制单面板 + 标签页）。

---

## 3. 状态模型

### 3.1 分层原则

| 状态 | 归属 | 是否持久化 |
| --- | --- | --- |
| 布局树、面板列表、每个面板的标签列表/激活标签/激活面板、分割比例 | **新的布局 store** | 是 |
| 路径、导航历史、文件列表、loading、filter | 每个面板组件实例（`useNavigation`） | 路径持久化；历史可持久化 |
| 选择、排序、滚动位置、虚拟列表内部状态 | 每个 `FileList` 实例 + 既有 `explorerStateMap` | 排序/滚动按 path 持久化 |
| 剪贴板 | 既有 `useSharedRef`（全局，正确） | 跨窗口共享 |

关键取舍：**面板用"懒挂载 + `v-show` 保活"，而不是"只挂 active + 状态外置 store"。**
理由：`FileList` 已经封装了选择/排序/滚动/虚拟化，保活等于零成本地保住这些状态；全部外置到 store 反而要重写 `useSelection`、`useVirtualList`。代价是 N 个隐藏面板常驻内存，用第 6.3 节的约束控制（懒挂载 + 隐藏时不加载预览 + 上限提示）。

### 3.2 类型定义（新文件 `ExplorerUI/explorer-layout-store.ts`）

```ts
export type PanelId = string
export type TabId = string

export interface ExplorerTabState {
  id: TabId
  path: string // normalizeListingPath 形态
}

export interface ExplorerPanelState {
  id: PanelId
  tabs: ExplorerTabState[]
  activeTabId: TabId
}

export type LayoutNode =
  | { type: 'panel', panelId: PanelId }
  | { type: 'split', direction: 'horizontal' | 'vertical', sizes: number[], children: LayoutNode[] }

export interface ExplorerLayoutState {
  version: 1
  layout: LayoutNode
  panels: Record<PanelId, ExplorerPanelState>
  activePanelId: PanelId
  /** 单面板 / 双列 / 双行 / 四宫格，仅用于预设按钮回填 */
  preset: 'single' | 'vertical' | 'horizontal' | 'quad'
}
```

持久化：新增 `LsKeys.EXPLORER_LAYOUT`，`useStorage(..., { mergeDefaults: true })`。首次启动若不存在，则由旧的 `LsKeys.NAV_PATH` **迁移**出一个单面板单标签。

Store 形态沿用项目现有风格（模块级 `reactive` + 持久化，参考 `views/Apps/apps-store.ts`；项目虽装了 pinia，但既有代码并未使用，不宜为新功能单独引入）。对外暴露一个 `useExplorerLayout()` 单例 composable：

```ts
addPanel(direction), removePanel(panelId), setPreset(preset),
addTab(panelId, path?), closeTab(panelId, tabId), moveTab(panelId, from, to),
setTabPath(panelId, tabId, path), setActivePanel(panelId), setActiveTab(panelId, tabId),
focusNextPanel(), focusNextTab(step), paneScopes, activeScope
```

### 3.3 面板运行时注册表（替代 `fileListRef` 命令式调用）

面板组件挂载时注册自己的 API，供跨面板命令使用：

```ts
// ExplorerUI/pane-registry.ts
export interface PaneApi {
  paneId: string
  basePath: Ref<string>
  selectedItems: Ref<IEntry[]>
  selectedPaths: Ref<string[]>
  refresh: () => void | Promise<void>
  openPath: (path: string) => void | Promise<void>
  selectByNames: (names: string[]) => void
  reveal: (name: string) => void
}
```

通过 `provide/inject`（`paneRegistryKey`）注入布局层。这解决了：
- F5/F6「复制/移动到另一面板」需要读取**另一个面板**的选择与路径；
- 拖拽 drop 需要判断目标面板是否需要刷新；
- `ExplorerEvents.SELECT_COLLECTED` / `REVEAL_ITEM`（来自 Apps 窗口）可以携带可选 `paneId`，缺省路由到活动面板，兼容现有按 `basePath` 匹配的行为（`FileManager.vue:180-186`）。

### 3.4 需要改造的旧状态

| 旧实现 | 改法 |
| --- | --- |
| `use-navigation.ts` 里 `useStorage(LsKeys.NAV_PATH)` | 去掉全局 key。`useNavigation` 接收 `basePath` 的 `get/set`（由面板绑定到 layout store 的当前标签），并保留 `NAV_PATH` 仅为「上次活动面板路径」用于 `?navPath=` 深链与旧数据迁移 |
| `NavigationHistory` | 每个面板一个实例（现状已是实例级），可选把 `{history, currentIndex}` 写进 layout store 以便重启恢复；不持久化也可接受 |
| `explorerStateMap`（按 path 存 position/sortMode） | 保持按 path。同一路径开在多个标签时，滚动/排序共享（后写覆盖）。若要严格隔离可加 `tabId` 维度，但会丢失「同一目录的首选项」语义，建议本期不做 |
| `localSettingsStore` 的 `isGridView/iconSize*/showHidden` | 保持全局默认；在 `ExplorerPanelState` 增加可选覆盖字段，面板右键菜单提供「本面板独立视图设置」。**本期可先不做**，只要明确不做就不会有回归 |

---

## 4. 组件拆分

```
FileManager.vue                     外壳：base scope、全局 header、FileSidebar、布局宿主
├── ExplorerLayout.vue              布局：递归渲染 LayoutNode（el-splitter）+ 活动面板判定
│   └── ExplorerPanel.vue           一个面板：TabBar + 面板工具栏 + 当前标签内容 + 焦点/激活处理
│       ├── ExplorerTabBar.vue      标签栏：新建/关闭/拖拽排序/右键菜单/drop 目标
│       └── ExplorerPane.vue        一个标签页内容（= 今天 FileManager.vue 的主体）
│           ├── AddressBar.vue      复用；新增「在此打开到新标签页 / 另一面板」
│           ├── FilterBar.vue       复用
│           ├── FileList.vue        复用 + 拖拽源/放置目标；新增 paneId prop
│           │   └── TransferQueue   见 4.1
│           └── 状态栏/媒体 FAB      复用
└── FileSidebar.vue                 复用（全局一份，操作活动面板）
```

### 4.1 `TransferQueue` 收敛为窗口级单例

现状：`useTransfer()` 在 `FileList.vue:395` 调用，`<TransferQueue>` 也渲染在 `FileList.vue:990`。多面板会得到 N 个传输窗口，且每个都用 `useFileDialog` 打开系统选择框。

建议：把 `TransferQueue` 与 `useTransfer` 提升到 `FileManager.vue`（窗口级一份），把「目标 `basePath` + `selectedItems`」作为参数传入上传/下载方法；`FileList`/面板通过注册表把任务提交给窗口级的 `TransferQueue`。

- 好处：一次操作一个传输窗口，符合现有 `auto-close` 行为；避免 N 个隐藏面板各挂一个窗口。
- 迁移成本：`useTransfer(basePath, isLoading, selectedItems)` 的调用点从 1 处（FileList）变成「任务提交」接口，上传/下载入口分散在 `FileList` 工具栏与右键菜单里，需要把 `selectUploadFiles/selectUploadFolder/confirmDownload/downloadToFolder` 改为从注入的窗口级 API 调用。
- 若想缩小第一期改动：先允许每面板一份（功能正确，只是窗口变多），把收敛放到 Phase 1 末尾。**推荐后者**，避免拖拽功能被基础设施重构拖住。

---

## 5. 多面板方案

### 5.1 布局与预设

- `ExplorerLayout.vue` 递归渲染 `LayoutNode`：`split` 用 `<el-splitter :layout="direction === 'vertical' ? 'vertical' : 'horizontal'">` + `<el-splitter-panel :size="pct%">`，叶子渲染 `ExplorerPanel`。项目已在 `FileManager.vue:431` 使用 `el-splitter`，保持一致。
- 预设按钮（header 或面板右上角菜单）：单面板 / 左右 / 上下 / 四宫格。切预设时保留已存在面板的标签，多出的面板创建在「当前面板路径」上（或首页），少的合并为标签。
- 分割比例写回 `LayoutNode.sizes`（`el-splitter` 的 `@resize` / 受控 `size`）。

### 5.2 活动面板

- 只有活动面板接收快捷键、侧边栏点击、全局工具栏动作。
- 激活方式：面板内 `mousedown`/`focusin` → `setActivePanel(id)`；Tab 键循环切换；点击面板标签栏也激活。
- 视觉：活动面板标题/标签栏用既有 token 区分（例如标签栏 `.vgo-panel--flat` 不变，活动面板在标签栏左侧或顶部加 1px 活动色条，纯布局 + token，不引入字面量颜色）。

### 5.3 全局外壳的行为

- `FileSidebar`（驱动器/收藏）保持一份，点击 → `activePanel.openPath(path)`。
- `FileLite.vue` 的 `#headerRight` 槽仍走全局 header。
- 媒体 FAB（`lastOpenedMediaItem`）只在活动面板显示，避免每个面板各一个。
- 深链 `?navPath=`（`FileManager.vue:95-110`）应用到**初始活动面板的初始标签**。

### 5.4 尺寸陷阱（务必处理）

- `FileManager.vue:509` 的 `.explorer-wrap { min-width: 300px }` 在双面板下会把布局撑破：面板外层必须 `min-width: 0; min-height: 0`，最小宽度改挂在面板自身（建议 220px）上。
- `.explorer-content-wrap { overflow: auto }`（:586）与嵌套 splitter 冲突：布局宿主改为 `overflow: hidden; min-height: 0`，滚动交回 `.explorer-content`。
- 移动端（`$mq_mobile_width`）强制 `preset: 'single'`，并把布局切换入口隐藏。

---

## 6. 多标签页方案

### 6.1 标签栏组件

- 结构：`.vgo-panel.vgo-panel--flat` 容器 + 每个标签一个 `.vgo-list-item`（激活加 `.is-active`），关闭按钮 `.vgo-button.vgo-button--text.vgo-button--icon.vgo-button--sm`。vgo-ui 没有 tabs 原语（已确认 dist 中无 `.vgo-tab*`），所以按 AGENTS 的 Style Overview 用 list-item 组合，**不要新建 tab 类名**。
- 标签标题：`getLastDirName(path)`（`utils/index.ts:46`），过长 `vgo-u-text-overflow`；`title` 显示完整路径。
- 交互：单击切换、中键关闭、双击/右键菜单（关闭、关闭其他、关闭右侧、复制标签、在浏览器新标签打开）、`+` 新建。
- 拖拽排序：HTML5 DnD（与文件拖拽共用一套 drop 高亮样式）；本期可先只做「拖拽排序」，不做「跨面板移动标签」。

### 6.2 快捷键

| 快捷键 | 动作 |
| --- | --- |
| `Ctrl+T` / `Alt+T` | 新标签（当前路径） |
| `Ctrl+W` | 关闭当前标签（最后一个标签则关闭面板或保留空面板，需拍板） |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 面板内下一个/上一个标签 |
| `Alt+1..9` | 跳到第 N 个标签（避开浏览器 `Ctrl+1..9`） |
| `Tab` / `Shift+Tab` | 切换活动面板 |
| `F5` / `F6` | 复制 / 移动到另一面板（单面板时禁用或降级为提示） |
| `F8` | 删除（与现有 `Delete` 并存） |
| `Alt+\` | 切换单/双面板 |

注意 `F5` 会触发浏览器刷新、`F6` 会聚焦地址栏，`useShortcut` 的 `preventDefault` 默认 `true`（`use-shortcut.ts:238`），可以拦下；但在 `F5` 被浏览器优先处理的环境需要验证（Chrome 下 `keydown` 的 `preventDefault` 能阻止 F5 刷新）。建议同时保留 `Alt+C` / `Alt+M` 备选。

### 6.3 保活与资源控制

- 方案：每个标签渲染一个 `ExplorerPane`，首次激活才挂载（`mountedTabs` 集合），之后用 `v-show` 保活。
- 隐藏标签因为 `display:none`，`ThemedIcon` 的 IntersectionObserver 不会触发，**不会加载预览**；虚拟列表在重新显示时由 ResizeObserver 触发 `refresh()`。
- 需要在「重新显示」时主动做一次：`virtualList.refresh()` / `virtualGrid.refresh()` + `getSetScrollPosition('set', position)`（现有 `FileList.vue:707-731` 的逻辑抽成 `restoreViewport()` 供显示时调用），否则隐藏期间尺寸为 0 会导致可视区为空。
- 标签数量不设硬上限；若担心内存，可在后续加「超过 N 个非活动标签则卸载最久未用」的 LRU，卸载前把状态快照进 store。本期不做。

### 6.4 「New Tab」语义调整

- `FileManager.vue:195 openPathInNewTab()` 从 `window.open(...)` 改为「在应用内当前面板新建标签」。
- 同时把原来的浏览器新标签能力留在右键菜单里，文案区分：`Open in new Tab`（应用内）/ `Open in new browser tab`（浏览器）。名称变化需要同步 `CHANGELOG.md`。

### 6.5 选择器模式

- `FileSelector` 传入 `mode="selector"`（或沿用 `selectFileMode` 判断）：
  - 强制单面板 + 单标签；
  - 隐藏布局切换与标签栏的关闭/新建；
  - `handleSelect` 仍返回**当前面板**的结果，语义不变。

---

## 7. 多选拖拽方案

### 7.1 传输协议

自定义 MIME：`application/x-file-lite-entries`，JSON：

```ts
interface FileLiteDragPayload {
  v: 1
  sourcePaneId: string
  sourceBasePath: string            // listing 形态
  items: { name: string, isDirectory: boolean }[]
}
```

- 之所以只传 name + 源目录，而不是绝对路径：避免把服务器绝对路径塞进 `text/plain`（可能被外部应用读到），drop 时再拼 `normalizePath(`${sourceBasePath}/${name}`)`。
- 同时写 `text/uri-list`（`getStreamUrl` 拼出的下载 URL）以支持拖到桌面/其他应用触发下载——可选，Phase 3 收尾做。
- 拖拽过程中**不能读 `dataTransfer.getData`**（浏览器安全限制），判定「是不是内部拖拽」用 `event.dataTransfer.types.includes('application/x-file-lite-entries')`。

### 7.2 拖拽源（`use-file-drag.ts`）

- 行/网格项加 `draggable="true"`。
- `dragstart`：
  1. 若指针下的项**不在**当前选择里 → 先把选择改为该项（Ctrl 时追加）；
  2. 组装 payload = 当前选择；
  3. 多选时用 `setDragImage(ghost)` 显示「N items」小标签（DOM 元素需 `position: fixed; top: -1000px`）；
  4. `effectAllowed = ctrlKey ? 'copy' : 'move'`。
- `dragend`：清理高亮、清理「刚拖过」标志位。
- 与剪切的视觉叠加：拖拽源保持 `is-cut` 半透明（已有 `currentCutNames`）。

### 7.3 放置目标（`use-file-drop.ts`）

按优先级识别 `destDir`：

| 目标 | destDir | Phase |
| --- | --- | --- |
| 文件夹行 / 网格文件夹项 | 该项的绝对路径 | 3 |
| 面板内容空白处 | 该面板当前路径 | 3 |
| 面包屑某一段（AddressBar） | 该祖先路径 | 3b |
| 标签页 | 该标签的路径（不自动切换，或悬停 500ms 后切换） | 3b |
| 另一个面板 | 该面板当前路径 | 3 |
| OS 外部（`text/uri-list`） | 交给浏览器下载 | 3b |

高亮：给目标加一个纯布局类（如 `is-drop-target`），描边用 `--vgo-primary` 的 token；不要新增面板/按钮类名（沿用 AGENTS 的 vocabulary）。

### 7.4 执行与守卫

复用后端 `copyPaste`，并把执行逻辑从 `use-copy-paste.ts` 抽出成共享的 `transferPaths({ fromPaths, toPath, isMove })`，让「粘贴」和「拖拽」走同一条路径（统一 loading、toast、刷新、`moveRefresh`）。

必须的守卫（缺一不可）：

1. `destDir` 归一化后等于 `sourceBasePath` → 拒绝（无意义）；
2. 拖拽项是目录且 `destDir` 以 `normalizeListingPath(itemPath)` 为前缀 → 拒绝（不能把文件夹拖进自己/子孙）；
3. 源项已经存在于目标目录（同名）→ **冲突处理**。需先确认后端 `copy-paste` 对同名文件的行为（覆盖 / 报错 / 自动改名）；若为静默覆盖，拖拽前必须用当前 listing 做一次重名检测，弹「覆盖/跳过/重命名」对话框。这是本期唯一需要先补的后端行为确认项；
4. `dropEffect === 'none'` 或数据非法 → 不执行。

执行后：

- 目标面板 `emit('refresh')`；
- 移动时设置 `moveRefresh = { fromPath: sourceBasePath, token }`（复用 `use-copy-paste.ts:105-113` 的机制）。同一文档内两个面板共享同一个 `useSharedRef`，源面板的 watcher 会命中路径并刷新；跨浏览器标签页由 BroadcastChannel 覆盖，行为与今天的粘贴完全一致。

### 7.5 与现有交互的冲突处理

1. **框选起点**：`canStartSelectionDrag`（`use-selection.ts:422`）增加排除 `.selectable`。即：只有在列表/网格的空白处按下才发起框选，在行上按下则准备拖拽。这与资源管理器/TC 一致，也能让 `handleContentMouseDown` 与原生 DnD 不再互相抢手势。
2. **点击清空选择**：框选结束时已用 `ignoreNextContentClick` 抑制一次 click（`use-selection.ts:187-203`）；原生 DnD 结束后通常不派发 click，但为稳妥再加一个 `justDragged` 标志，在 `handleContentClick` 里消费一次。
3. **复选框/按钮**：`.checkbox`、`a`、`input`、`.resizer` 上不启动拖拽（与现有排除列表一致）。
4. **上传拖放区**：`use-transfer.ts:239-253` 的 `useDropZone` 会对任何 drop 触发上传。内部拖拽必须在 `onDrop` 开头检查 `types`，命中自定义 MIME 就直接 `return`；同时 `isOverDropZone` 的高亮不应在内部拖拽时出现。
5. **自动滚动与弹簧夹**：拖动到列表上下边缘自动滚动，悬停文件夹 600ms 自动进入（TC 的 spring-loaded folders）。均属 Phase 3b 打磨项。
6. **触屏**：HTML5 DnD 在触屏上不可用。兜底方案：右键菜单增加「Move to… / Copy to…」，直接用现成的 `FileSelector`（folder 模式）选目标目录——这条兜底也顺便覆盖了键盘用户。

---

## 8. 快捷键作用域改造（多面板的关键）

现状问题见 1.2 第 2 条。推荐方案：

1. **每个面板实例一个唯一 scope**：`fileManager:<panelId>`（选择器为 `fileSelector:<panelId>`）。`provide(shortcutScopeKey, ...)` 在面板层提供，`FileList` 继续 `inject`，注册代码零改动。
2. **扩展 `getFallbackScope()`**（`use-shortcut.ts:115-124`）：事件目标不在任何 `[data-shortcut-scope]` 内时，先返回**布局 store 的活动面板 scope**，再回退到 apps 窗口。这样点击全局工具栏后按方向键仍作用于活动面板。
3. **面板激活**：面板根元素上加 `@mousedown.capture` / `@focusin` → `setActivePanel(id)`。点击面板 B 时，`event.target.closest` 命中的是 B 的 scope，天然路由到 B；两者一致。
4. **标签页**：只有活动标签在 scope 上可见（隐藏标签用 `v-show`，其注册仍在，但 scope 属于面板而非标签）。因此**需要把 scope 细化到标签**：`fileManager:<panelId>:<tabId>`，并把活动面板 scope 定义为「活动面板的活动标签 scope」。这样隐藏标签的注册永远不会被命中，无需给每个 `useShortcut` 传 `disabled`。
   - 备选（改动更小但更啰嗦）：所有面板共用一个 scope，每个 `useShortcut` 传 `disabled: () => !isActivePane || !isActiveTab`。i.e. 依赖 `use-shortcut.ts:165` 的 disabled 提前跳过。不推荐，因为要在 20+ 处注册里重复这个条件。
5. `FileSelector` 的 `shortcutScope` prop 保留，作为 scope 前缀。

---

## 9. 分阶段实施计划

每一阶段都可独立提交、独立验证。

### Phase 0 —— 无行为变化的重构（准备）

1. 新建 `ExplorerPane.vue`，把 `FileManager.vue` 的主体（header 工具栏 + AddressBar + FilterBar + FileList + 状态栏 + 媒体 FAB）搬进去；`FileManager.vue` 退化为外壳。
2. 引入 `explorer-layout-store.ts`，先固定为「1 面板 1 标签」；`ExplorerPane` 的路径从 store 读写，替换 `useNavigation` 里的全局 `LsKeys.NAV_PATH`。
3. 引入 `pane-registry.ts`，用注册表 API 取代 `fileListRef` 的零散命令调用（`selectByNames/selectAndReveal/sortedFiles` 等）。
4. 快捷键 scope 细化到 pane/tab，扩展 `getFallbackScope()`。
5. `FileList` 增加 `paneId` prop 并在 `defineExpose` 里补 `selectedPaths`。

验收：功能与今天完全一致（黄金路径手测：导航、选择、复制粘贴、上传下载、新建/重命名/删除、右键菜单、Apps 联动、深链 `?navPath=`、FileSelector）。

### Phase 1 —— 多面板

6. `ExplorerLayout.vue`：递归 splitter + 预设（单/左右/上下/四宫格）+ 比例持久化。
7. 活动面板：点击激活、`Tab` 切换、视觉标识；侧边栏与全局 header 作用于活动面板。
8. 跨面板命令：`F5` 复制到另一面板、`F6` 移动到另一面板、右键「Open in other panel」。
9. 面板右键菜单：关闭面板、在本面板/新面板打开。
10. `TransferQueue` 收敛为窗口级单例（若时间紧可后移）。

### Phase 2 —— 多标签页

11. `ExplorerTabBar.vue` + 标签 CRUD + 懒挂载/`v-show` 保活 + 重新显示时 `restoreViewport()`。
12. 标签快捷键与右键菜单；`openPathInNewTab` 改为应用内标签，另留「在浏览器新标签打开」。
13. 标签拖拽排序；会话恢复（重启后还原面板/标签/路径/活动项）。
14. 选择器模式锁定为单面板单标签。

### Phase 3 —— 多选拖拽

15. `use-file-drag.ts` + 行/网格 `draggable` + 选择联动 + 自定义拖拽影像。
16. `use-file-drop.ts`：文件夹行、面板空白、另一面板；高亮；守卫；刷新。
17. 抽出共享 `transferPaths()`，粘贴与拖拽共用；确认并处理同名冲突策略。
18. 修正 `canStartSelectionDrag` 排除 `.selectable`；上传 drop zone 排除内部拖拽。
19. 面包屑/标签页 drop、自动滚动、弹簧夹、`text/uri-list`、触屏兜底菜单（按优先级取）。

---

## 10. 风险、取舍与待拍板项

### 10.1 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 隐藏面板的资源占用 | 每个保活标签常驻 `FileList`（虚拟列表 + 观察者 + 缩略图管线） | 懒挂载 + IntersectionObserver 天然不加载隐藏预览；必要时后续加 LRU 卸载 |
| 快捷键误路由 | scope 细化后，若忘记扩展 `getFallbackScope`，点全局按钮后按键失效 | Phase 0 一并改，并补一条手工回归清单 |
| 排序/滚动按 path 共享 | 同一目录开在两个标签会互相影响 | 明确接受；文档记录 |
| 同名覆盖 | 拖拽落到已存在同名文件 | Phase 3 前先核实后端 `copy-paste` 语义 |
| 视图偏好全局联动 | 切网格/图标大小影响所有面板 | 本期明确不做独立；面板级覆盖留字段 |
| 样式越界 | 标签栏/拖拽高亮容易写出字面量颜色 | 只用 `.vgo-list-item`/`.vgo-panel--flat` + token；提交前跑 `bun run lint` |

### 10.2 需要你拍板的问题

1. **面板数量上限**：只做双面板（TC 风格）还是 4 宫格（Q-Dir 风格）？四宫格会放大 10.1 的所有资源问题。
2. **拖拽默认效果**：默认移动（文件管理器惯例）还是默认复制（浏览器惯例）？Ctrl 反向。是否需要提供设置开关？
3. **`Ctrl+W` 关闭最后一个标签**：关闭整个面板，还是保留一个空面板（显示驱动器列表）？
4. **视图偏好是否分面板**：网格/列表、图标大小、隐藏文件是全局联动，还是每个面板独立记忆？
5. **`TransferQueue` 收敛**：接受「全窗口一个传输窗口」，还是保留每面板一个？
6. **同名冲突**：覆盖 / 跳过 / 自动改名 / 每次询问？
7. **移动端**：是否接受移动端强制单面板 + 只保留标签页？

---

## 11. 受影响文件清单

**新增**

- `frontend/src/views/FileManager/ExplorerUI/explorer-layout-store.ts`
- `frontend/src/views/FileManager/ExplorerUI/pane-registry.ts`
- `frontend/src/views/FileManager/ExplorerLayout.vue`
- `frontend/src/views/FileManager/ExplorerPanel.vue`
- `frontend/src/views/FileManager/ExplorerTabBar.vue`
- `frontend/src/views/FileManager/ExplorerPane.vue`
- `frontend/src/views/FileManager/ExplorerUI/hooks/use-file-drag.ts`
- `frontend/src/views/FileManager/ExplorerUI/hooks/use-file-drop.ts`
- `frontend/src/views/FileManager/ExplorerUI/hooks/explorer-transfer.ts`（共享 transferPaths）

**改动**

- `FileManager.vue`（退化为外壳 + 布局宿主 + 选择器模式分支）
- `FileList.vue`（`paneId`、拖拽源/放置目标、`selectedPaths` 暴露、`restoreViewport`）
- `ExplorerUI/hooks/use-selection.ts`（框选起点排除 `.selectable`、`justDragged` 抑制、拖拽所需导出）
- `ExplorerUI/hooks/use-navigation.ts`（去掉全局 `NAV_PATH`，改为接收路径绑定）
- `ExplorerUI/hooks/use-transfer.ts` + `TransferQueue.vue`（可选：提升到窗口级）
- `ExplorerUI/hooks/use-copy-paste.ts`（抽出 `transferPaths`）
- `hooks/use-shortcut.ts`（`getFallbackScope` 支持活动面板）
- `enum/index.ts`（新增 `EXPLORER_LAYOUT`）
- `FileSelector.vue`（`mode`/单面板约束）
- `FileSidebar.vue`（改为操作活动面板）
- `AddressBar.vue`（「新标签/另一面板打开」、面包屑 drop 目标）
- `CHANGELOG.md`（按项目规范，用户可感知的变化）
