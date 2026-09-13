# 前端：多面板 / 多标签页 设计方案

> 状态：**多面板方案搁置（暂不实现）**。产品侧已决定不做多面板模式，因此本文只作为设计参考保留，
> 第 8 节的多面板分阶段计划**没有执行**；`ExplorerLayout` / pane 注册表等新文件都不存在。
>
> 本文已经拆出两块并**单独实现**：
> - **多选拖拽**：见 `ExplorerUI/entry-drag.ts` 与 `ExplorerUI/hooks/use-transfer.ts`（拖到文件夹行 /
>   面包屑 / 收藏夹 / 磁盘根，同卷移动、跨卷复制，Ctrl 拖回原目录即 duplicate，系统拖入即上传到该目录）。
> - **多标签页**：见 [`docs/design/explorer-tabs-design.md`](../design/explorer-tabs-design.md)。实际做成了**全局一条标签栏、
>   只切换 `explorer-main`**，与本文原先「每个面板一条标签栏」的假设不同，所以本文的标签相关章节已删除。
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
3. ~~**没有可复用的"单个列表"状态单元**~~：多标签阶段已经把 `FileManager.vue` 拆成外壳 + `ExplorerPane.vue`（工具栏 + 列表），面板可以直接复用这个边界。
4. ~~**"New Tab" 名不副实**：`openPathInNewTab()` 曾经是 `window.open` 浏览器标签页~~ —— 已修复：现在是应用内标签页。
5. **视图偏好在全局**：`isGridView` / `iconSizeList` / `iconSizeGrid` / `showHidden` 存在 `localSettingsStore`（`store/index.ts:47-64`），多面板会联动。
6. **`TransferQueue` 每个 FileList 一个**：多面板会产生 N 个传输窗口/队列。
7. **选择以 name 为键**：`use-selection.ts` 的 `Set<IEntry>` + `Set<string>` 只在本目录内成立；跨面板操作需要绝对路径（`selectedPaths` 目前只在 `FileList` 内部用，没有通过 `defineExpose` 暴露）。

### 1.3 可以直接复用的既有能力

- **剪贴板已经是跨面板/跨窗口的**：`use-copy-paste.ts` 的 `useSharedRef` 在同一文档内是同一个 `ref`。
- **选择框、虚拟滚动、缩略图管线**都已独立成 hook，可原样放进面板。
- **`ThemedIcon` 用 IntersectionObserver 控制预览加载**（`ThemedIcon.vue:170`）。`v-show` 隐藏的标签页 `display:none` → 不进入视口 → **天然不会发预览请求**，无需额外改造。
- **拖拽的落点协议**（`ExplorerUI/entry-drag.ts`）与面板无关，跨面板拖动（F5/F6 或拖到另一个面板）可以直接复用。

---

## 2. 目标与范围

### 2.1 目标

- **多面板**：单面板 / 左右双面板 / 上下双面板 / 四宫格，可拖动分隔条调整比例；任意时刻只有一个"活动面板"。
- **选择器模式不受影响**：`FileSelector` 仍是单面板、单标签，`handleSelect` 契约不变。

### 2.2 非目标（本期不做）

- 重写后端。
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
| `use-navigation.ts` 里 `useStorage(LsKeys.NAV_PATH)` | **已实现**：`useNavigation` 改为接收外部 `basePath` 绑定，多标签下由外壳绑定到当前标签；`NAV_PATH` 只作为「上次路径」用于 `?navPath=` 深链与旧数据迁移 |
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

## 6. 多标签页

已单独实现并拆出，见 [`docs/design/explorer-tabs-design.md`](../design/explorer-tabs-design.md)。
实现形态与本节原方案不同（全局一条标签栏、只切换 `explorer-main`，没有 pane 注册表），
不再在本文保留设计。

## 7. 快捷键作用域改造（多面板的关键）

现状问题见 1.2 第 2 条。推荐方案：

1. **每个面板实例一个唯一 scope**：`fileManager:<panelId>`（选择器为 `fileSelector:<panelId>`）。`provide(shortcutScopeKey, ...)` 在面板层提供，`FileList` 继续 `inject`，注册代码零改动。
2. **扩展 `getFallbackScope()`**（`use-shortcut.ts:115-124`）：事件目标不在任何 `[data-shortcut-scope]` 内时，先返回**布局 store 的活动面板 scope**，再回退到 apps 窗口。这样点击全局工具栏后按方向键仍作用于活动面板。
3. **面板激活**：面板根元素上加 `@mousedown.capture` / `@focusin` → `setActivePanel(id)`。点击面板 B 时，`event.target.closest` 命中的是 B 的 scope，天然路由到 B；两者一致。
4. **标签页**：**已实现**（多标签阶段）——每个面板的 scope 是 `fileManager:<tabId>`，外壳根节点的 `data-shortcut-scope` 动态指向活动标签的 scope，隐藏标签的注册永远不会被命中，无需给每个 `useShortcut` 传 `disabled`。多面板落地时再在前面加上 `panelId` 维度。
   - 备选（改动更小但更啰嗦）：所有面板共用一个 scope，每个 `useShortcut` 传 `disabled: () => !isActivePane || !isActiveTab`。i.e. 依赖 `use-shortcut.ts:165` 的 disabled 提前跳过。不推荐，因为要在 20+ 处注册里重复这个条件。
5. `FileSelector` 的 `shortcutScope` prop 保留，作为 scope 前缀。

---

## 8. 分阶段实施计划

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

## 9. 风险、取舍与待拍板项

### 9.1 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 隐藏面板的资源占用 | 每个保活标签常驻 `FileList`（虚拟列表 + 观察者 + 缩略图管线） | 懒挂载 + IntersectionObserver 天然不加载隐藏预览；必要时后续加 LRU 卸载 |
| 快捷键误路由 | scope 细化后，若忘记扩展 `getFallbackScope`，点全局按钮后按键失效 | Phase 0 一并改，并补一条手工回归清单 |
| 排序/滚动按 path 共享 | 同一目录开在两个标签会互相影响 | 明确接受；文档记录 |
| 视图偏好全局联动 | 切网格/图标大小影响所有面板 | 本期明确不做独立；面板级覆盖留字段 |
| 样式越界 | 标签栏容易写出字面量颜色 | 只用 `.vgo-list-item`/`.vgo-panel--flat` + token；提交前跑 `bun run lint` |

### 9.2 需要你拍板的问题

1. **面板数量上限**：只做双面板（TC 风格）还是 4 宫格（Q-Dir 风格）？四宫格会放大 9.1 的所有资源问题。
2. ~~**`Ctrl+W` 关闭最后一个标签**~~：已定——至少保留 1 个标签，不允许关闭（快捷键用的是 `Alt+W`，`Ctrl+W` 被浏览器占用）。
3. **视图偏好是否分面板**：网格/列表、图标大小、隐藏文件是全局联动，还是每个面板独立记忆？
4. **`TransferQueue` 收敛**：接受「全窗口一个传输窗口」，还是保留每面板一个？
5. **移动端**：是否接受移动端强制单面板 + 只保留标签页？

---

## 10. 受影响文件清单

**新增**（多面板相关；`ExplorerPane.vue` / `ExplorerTabBar.vue` 已在多标签阶段落地，见 `docs/design/explorer-tabs-design.md`）

- `frontend/src/views/FileManager/ExplorerUI/explorer-layout-store.ts`
- `frontend/src/views/FileManager/ExplorerUI/pane-registry.ts`
- `frontend/src/views/FileManager/ExplorerLayout.vue`
- `frontend/src/views/FileManager/ExplorerPanel.vue`

**改动**

- `FileManager.vue`（退化为外壳 + 布局宿主 + 选择器模式分支）
- `FileList.vue`（`paneId`、`selectedPaths` 暴露、`restoreViewport`）
- `ExplorerUI/hooks/use-navigation.ts`（去掉全局 `NAV_PATH`，改为接收路径绑定）
- `ExplorerUI/hooks/use-transfer.ts` + `TransferQueue.vue`（可选：提升到窗口级）
- `hooks/use-shortcut.ts`（`getFallbackScope` 支持活动面板）
- `enum/index.ts`（新增 `EXPLORER_LAYOUT`）
- `FileSelector.vue`（`mode`/单面板约束）
- `FileSidebar.vue`（改为操作活动面板）
- `AddressBar.vue`（「新标签/另一面板打开」）
- `CHANGELOG.md`（按项目规范，用户可感知的变化）
