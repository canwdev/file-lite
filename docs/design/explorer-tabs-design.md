# 前端：内置多标签页设计（已实现）

> 状态：**已实现**（前端）。本文记录已落地的多标签页与拆分视图，以及与原方案的差异。
>
> 测试覆盖：`e2e/tests/08-tabs.spec.ts` 与 `e2e/tests/10-split-view.spec.ts`，
> 并依赖 `helpers.ts` 把行 / 导航定位限定在可见面板内。

## 1. 与原方案的差异

原方案假设「每个面板一个标签栏 + 多面板布局」，产品侧已决定不做自由多面板，因此实际实现改为：

- **全局一条标签栏**，放在已有的 `explorer-top-bar__left`（之前是预留的空占位）。
- **只切换 `explorer-main` 内容区域**：顶栏、左侧导航、对话框、传输面板都是全局共享的；左侧导航只作用于当前活动标签。
- 原方案 §3.3 的 pane 注册表没有实现——标签模式下外壳不需要引用面板实例（只有选择器需要，用普通模板 ref 即可）。
- 1.5.0 起**单个标签内部**可以有 2 个面板（拆分视图，见 §5），但全局仍然只有一条标签栏。

## 2. 结构与状态

```
FileLite.vue                        页面壳：顶栏（标签栏 + 页面标题 + 传输面板入口 + 全局菜单）
└── FileManager.vue                 外壳：.explorer-wrap / #topBar 插槽 / 侧边栏 / 对话框 / 选择器底栏
    └── .explorer-body
        ├── FileSidebar             全局一份，作用于活动标签
        └── .explorer-tab-panel × N 每个标签项一个，v-show 保活（键为 item.id）
            └── el-splitter         单标签项 1 个面板，拆分项 2 个面板
                └── ExplorerPane     面板本身
```

- 标签状态在 `ExplorerUI/explorer-tabs-store.ts`：模块级 `useStorage`（`LsKeys.EXPLORER_TABS`），
  存 `{ items: [{ id, tabs: [{ id, path, view? }], split?, activeTabId }], activeItemId }`，
  风格与 `Apps/apps-store.ts` 一致（未引入 pinia）。两层结构、`view` 的含义见 §5。
- 首次启动没有该键时，用旧的 `LsKeys.NAV_PATH` 迁移出 1 个标签；活动标签的路径继续镜像回 `NAV_PATH`，
  保证 `?navPath=` 深链与文件选择器的初始目录行为不变。
- `path` 原样保存（可能是空串）：空串代表「还没导航过」，外壳据此决定是否打开第一个磁盘。
- **至少保留 1 项**：`closeTab` 在只剩 1 项时返回 false，关闭按钮同时 `disabled`。
- 排序/滚动仍按路径存在 `explorerStateMap`（同一目录开两个标签时共享），这是原方案 §3.4 明确的取舍。

## 3. 保活与恢复

- 每个面板渲染一个 `ExplorerPane`，用 `v-show` 而不是 `v-if`：选择、过滤、滚动、虚拟列表状态零成本保住。
- 挂载时（活动项）拉一次目录；之后每次被激活，没数据就拉一次，有数据只调 `FileList.restoreViewport()`
  恢复滚动位置（隐藏期间容器尺寸为 0，虚拟列表需要重新量）。拆分项里的两个面板都算「活动」。
- 隐藏标签 `display:none` → `ThemedIcon` 的 IntersectionObserver 不触发，不会加载缩略图预览。
- 懒挂载（激活过才挂载）没有单独实现：外壳只对活动标签触发加载，未激活过的标签不会发请求。

## 4. 标签栏交互（`ExplorerTabBar.vue`）

- BEM 块 `explorer-tabs`，标签项复用 `.vgo-list-item`（活动加 `.is-active`），关闭 / 新建用 `.vgo-button`，
  不新增 vgo 原语。
- 高亮：`.is-active` 只留 `--vgo-primary-opacity` 底色，去掉 `vgo-list-item.is-active` 自带的 1px outline
  （与侧边栏磁盘 / 收藏项一致）。
- 挤压不换行：容器 `flex-wrap: nowrap; overflow: hidden`，标签项 `flex: 1 1 auto; min-width: 2.5rem;
  max-width: 12rem`（拆分项 16rem），标题省略号；标签之间不留空隙，用一条短分隔线区分（相邻两个都不是活动标签时才画）。
- 高度：标签项强制 `height/min-height: var(--vgo-control-md)`。`vgo-list-item` 的 `min-height` 是
  `control-lg`，不覆盖就会把顶栏撑得比 `explorer-header` 高。
- 高亮是圆角 + 主题色底、不带 outline。注意 `&__item` 只编译成 `.explorer-tabs__item`（不会带上
  `.explorer-tabs` 前缀，特异度 (0,3,0)），盖不住主题的 (0,3,1)，所以去掉 outline 的那条要显式再套一层父选择器。
- 无动画：不写 transition。
- 操作：单击切换、中键关闭、关闭按钮（**只剩一项时不渲染**）、`+` 新建（沿用当前标签的路径，**永远追加在最后**并激活）；`+` 与关闭是小号的圆形按钮。
- 右键菜单最上面是 `Split view`（见 §5）并压一条分隔线，下面保持 Close / Close others / Close to the left /
  Close to the right，都天然满足「至少保留 1 项」。
- 排序拖拽用自己的 MIME（`application/x-file-lite-tab`），插入下标按指针在标签左 / 右半边计算，
  插入线用 `::after` 画（3px 宽，比标签之间的分隔线粗）。
- **标签不是文件落点**：拖文件经过标签时只启动 500ms 计时器，不调用 `preventDefault`，
  因此浏览器不会把标签当成合法落点；到点后切到该标签，用户再在内容区放下。
- 标签自己的排序拖拽与「文件经过标签」靠 MIME 区分，互不干扰。

## 5. 拆分视图

一个标签项内部可以有 2 个面板，在标签条上合并成一个格子、共享一个关闭按钮。

- **两层结构**：`ExplorerTab` 是面板（真正渲染文件列表、持有 path），`ExplorerTabItem` 是标签条上的一项，
  含 1 个（单标签）或 2 个（拆分）面板；项还带 `split`（分隔线方向）与 `activeTabId`（项内聚焦的面板）。
  全局只有 `activeItemId` 一个活动项，聚焦面板由它上面的 `activeTabId` 给出。
- **入口只有右键菜单**：单标签项第一项是 `Split view`（直接拆）；拆分项第一项是 `Split view` 子菜单
  （`Unsplit` / `Split horizontally`|`Split vertically` / `Swap views`）。切换项与图标都描述**目标**方向
  （`arrow-split-vertical` = 竖分隔线左右并排，`arrow-split-horizontal` = 横分隔线上下堆叠），
  `Unsplit` 不给图标。不做「把一个标签拖到另一个标签上形成拆分」，也不做 3 个以上面板。
- **拆分时的合并规则**（对齐 Chrome）：优先吸收**右邻单标签项**，右侧不是单标签时用**左邻**，
  两侧都没有就新建一个同路径标签当第二个面板。合并后的项落在两者中靠前的位置，面板顺序保持原来的左右顺序，
  聚焦的面板永远是右键的那一个。默认方向 `vertical` = 竖直分隔线、左右并排。
- **取消拆分是无损的**：换回两个独立标签，按原顺序插回原位置。
- **关闭语义**：关闭按钮 / 中键 / 菜单 Close / `Alt+W` 都关掉**整个项**（拆分时两个面板一起），
  「至少保留 1 项」不变；要把拆分变回单面板只能先 `Unsplit`。
- **布局**：一项一个 `<el-splitter>`，单标签项只有 1 个 `<el-splitter-panel>`（element-plus 这时不画分隔线），
  所以单 / 拆共用同一套 DOM。`split` 存的是**分隔线方向**，而 el-splitter 的 `layout` 是**排列方向**，两者相反，
  映射只在 `FileManager.vue` 的 `splitterLayout()` 里做一次。`.el-splitter-panel` 自带的 `overflow: auto`
  被覆盖成 `hidden`，否则会和面板内部的滚动容器叠成两条滚动条。
- **大小不持久化**：拖动分隔线只改 element-plus 组件内的 px 尺寸，刷新 / 重挂后回到均分。
- **点哪个面板哪个面板就聚焦**：`el-splitter-panel` 上的 `mousedown` / `focusin` 调 `activateTab`，
  于是侧边栏高亮、地址栏、快捷键作用域（`fileManager:<panelId>`，见 §7）一起跟过去；
  拆分项里聚焦的那个面板还会得到一圈主题色 inset 描边，单标签项不给（只有一个面板时是噪音）。
  描边**必须是面板里的绝对定位浮层**（`.explorer-pane-outline`，`pointer-events: none`、
  `z-index: --vgo-z-sticky`）：直接画在 `.explorer-main` 上会被工具栏 / 滚动区 / 状态栏这些有背景的
  子元素盖住，四条边只剩一部分看得见。
  反过来，面板加载完把 DOM 焦点抢进文件列表这件事（`FileList` 的 `focusFileList`）只允许**聚焦的那个面板**做，
  否则被吸收进来的邻接标签一加载完就会把活动面板抢走：`FileList` 因此多了一个 `focused` prop，
  由 `ExplorerPane` 从外壳拿 `pane.id === activeTabId` 传下去。
- **标签条上的合并格子**：两个标题各自可点（点哪半就聚焦哪个面板），聚焦的那半正常色、另一半压暗，
  两半之间画一条 1px 分隔线；字号小一档（`--vgo-font-sm`），半块左侧留 `--vgo-space-1` 内边距避免标题贴住分隔线。
  宽度是 `min-width: 10rem` + `max-width: 18rem`：标签条本身不撑满、标签按内容收缩，单标签的
  `max-width: 12rem` 从来只是上限（实测单个约 5.7rem），所以拆分项靠 `min-width` 撑开——
  不加时两个标题各差 2px，会被省略号截成 `sour…`。
- **视图偏好按面板走**：list/grid 与图标大小（`ExplorerPaneView`）挂在 `ExplorerTab.view` 上，
  跟标签内容一起持久化，所以拆分里的两个面板可以一个列表一个大图标、互不影响。
  没设置过的面板回落到全局设置（`localSettingsStore`），选择器窗口没有面板级状态、继续读写全局设置
  （外壳在 `FileManager` 里用一份本地 `selectorView` 承接并写回全局）。
- 被吸收进来的邻接标签的面板会换父节点重挂，因此会重新拉一次目录——这是唯一的可见代价。
- 两个面板都在同一个目录时共享 `explorerStateMap` 的排序 / 滚动记录（同 §2 的取舍）；
  视图偏好不受这条影响，仍然各面板独立。

## 6. 快捷键

| 快捷键 | 动作 |
| --- | --- |
| `Alt+T` | 新建标签（当前路径） |
| `Alt+W` | 关闭当前标签项（拆分时两个面板一起；只剩 1 项时无操作） |
| `Alt+1..9` | 跳到第 N 个标签项 |

未使用 `Ctrl+T` / `Ctrl+W` / `Ctrl+Tab`：Chrome 把这几个保留给浏览器自身，页面收不到 `keydown`。
实现上没有走 `useShortcut`（那套按 scope 路由，标签操作属于外壳、要作用于活动标签），
而是在外壳直接监听 `keydown`，并排除输入框与已激活的 App 窗口。

## 7. 快捷键作用域（多标签的关键）

- 面板的 scope 是 `fileManager:<panelId>`（选择器仍是 `fileSelector`）。
- 外壳根节点 `.explorer-wrap` 的 `data-shortcut-scope` **动态指向聚焦面板的 scope**，于是：
  - 焦点在面板内 → `closest` 命中外壳属性，解析出聚焦面板的 scope；
  - 焦点在顶栏 / 侧边栏 → 同样命中外壳属性，仍然落到聚焦面板。
- 隐藏标签的注册还在，但它们的 scope 字符串与活动值不同，永远不会被命中，
  不必给几十处 `useShortcut` 逐个加 `disabled`。

## 8. 选择器模式

- `FileSelector` 不传 `tabsMode`，外壳走「选择器」分支：只渲染 1 个 `ExplorerPane`，
  路径用本地的 `NAV_PATH`，不读不写标签 store。
- 标签栏在 `FileLite` 的顶栏里，选择器窗口没有顶栏，天然没有标签栏。
- 选择器的右键菜单是 selection-only，`handleSelect` 契约不变。

## 9. 传输面板

- `<TransferQueue>` 全局只有一份，挂在顶栏（面板本身 Teleport 到 body）；面板从**顶栏右下角**出现，
  `top` 用 `--explorer-top-bar-height`（`styles/style.scss` 里的 `:root` 变量，顶栏自己也用它定高）。
- `ExplorerUI/transfer-queue-registry.ts` 保存那个唯一实例的 API；各标签的上传 / 下载入口往同一个队列塞任务。
- 上传管线与「系统文件拖入」的 sink 移到模块级：之前每个 `FileList` 注册一次 sink，多实例时后者会覆盖前者。
- 队列跑完一批后通过 `ExplorerEvents.TRANSFER_DONE` 广播，各标签自己按目录过滤后补丁自己的列表
  （不再由某一个列表绑定 `@all-done`）。

## 10. 测试覆盖

`e2e/tests/08-tabs.spec.ts`（单标签、标签条本身）：

1. 标签栏与顶栏等高、标签项有圆角且无 outline。
2. 新增 / 切换 / 保活 / 关闭 / 持久化（含「最后一个标签不能关」）。
3. 拖拽排序并持久化。
4. 拖文件悬停标签 500ms 自动切换，且直接落在标签上不产生任何文件操作。
5. `Alt+T` / `Alt+数字` / `Alt+W` 快捷键。
6. 右键菜单的 Close to the left / right / others。
7. 拖到另一个标签页的内容区 = 落到该目录。

`e2e/tests/10-split-view.spec.ts`（拆分视图）：

1. 拆分吸收右邻标签：一项两个标题、一个关闭按钮、左右并排、两个面板 + 两个面包屑。
2. 没有邻接标签时新建一个同路径面板。
3. 子菜单：Swap views 交换、Split horizontally 换方向、Unsplit 无损拆回两个标签。
4. 一个关闭按钮关掉两个面板；刷新后拆分结构保留。
5. 跨面板拖文件落盘；拖动 el-splitter 分隔线改变两个面板宽度。
6. 两个面板的 list/grid 与图标大小互不影响，刷新后各自保留。

`helpers.ts` 的 `row()`、`currentCrumb()`、返回 / 复制 / 粘贴按钮定位都限定在 `.explorer-main:visible` 内，
否则保活标签里隐藏面板的同名元素会撞上 Playwright 的 strict mode；拆分相关用例改用
`pane()` / `paneRow()` / `paneCrumb()` 按面板下标定位。
