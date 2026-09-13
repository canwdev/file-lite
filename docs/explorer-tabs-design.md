# 前端：内置多标签页设计（已实现）

> 状态：**已实现**（前端）。原方案见 [`docs/todo/frontend-multi-panel-design.md`](./todo/frontend-multi-panel-design.md)，
> 其中「多面板」部分仍然搁置，本文只记录已落地的多标签页部分，以及与原方案的差异。
>
> 测试覆盖：`e2e/tests/08-tabs.spec.ts`（4 个用例），并依赖 `helpers.ts` 把行 / 导航定位限定在可见面板内。

## 1. 与原方案的差异

原方案假设「每个面板一个标签栏 + 多面板布局」，产品侧已决定不做多面板，因此实际实现改为：

- **全局一条标签栏**，放在已有的 `explorer-top-bar__left`（之前是预留的空占位）。
- **只切换 `explorer-main` 内容区域**：顶栏、左侧导航、对话框、传输面板都是全局共享的；左侧导航只作用于当前活动标签。
- 原方案 §3.3 的 pane 注册表没有实现——标签模式下外壳不需要引用面板实例（只有选择器需要，用普通模板 ref 即可）。

## 2. 结构与状态

```
FileLite.vue                        页面壳：顶栏（标签栏 + 页面标题 + 传输面板入口 + 全局菜单）
└── FileManager.vue                 外壳：.explorer-wrap / #topBar 插槽 / 侧边栏 / 对话框 / 选择器底栏
    └── .explorer-body
        ├── FileSidebar             全局一份，作用于活动标签
        └── ExplorerPane × N        每个标签一个，v-show 保活（键为 tab.id）
```

- 标签状态在 `ExplorerUI/explorer-tabs-store.ts`：模块级 `useStorage`（`LsKeys.EXPLORER_TABS`），
  存 `{ tabs: [{ id, path }], activeTabId }`，风格与 `Apps/apps-store.ts` 一致（未引入 pinia）。
- 首次启动没有该键时，用旧的 `LsKeys.NAV_PATH` 迁移出 1 个标签；活动标签的路径继续镜像回 `NAV_PATH`，
  保证 `?navPath=` 深链与文件选择器的初始目录行为不变。
- `path` 原样保存（可能是空串）：空串代表「还没导航过」，外壳据此决定是否打开第一个磁盘。
- **至少保留 1 个标签**：`closeTab` 在只剩 1 个时返回 false，关闭按钮同时 `disabled`。
- 排序/滚动仍按路径存在 `explorerStateMap`（同一目录开两个标签时共享），这是原方案 §3.4 明确的取舍。

## 3. 保活与恢复

- 每个标签渲染一个 `ExplorerPane`，用 `v-show` 而不是 `v-if`：选择、过滤、滚动、虚拟列表状态零成本保住。
- 挂载时（活动标签）拉一次目录；之后每次被激活，没数据就拉一次，有数据只调 `FileList.restoreViewport()`
  恢复滚动位置（隐藏期间容器尺寸为 0，虚拟列表需要重新量）。
- 隐藏标签 `display:none` → `ThemedIcon` 的 IntersectionObserver 不触发，不会加载缩略图预览。
- 懒挂载（激活过才挂载）没有单独实现：外壳只对活动标签触发加载，未激活过的标签不会发请求。

## 4. 标签栏交互（`ExplorerTabBar.vue`）

- BEM 块 `explorer-tabs`，标签项复用 `.vgo-list-item`（活动加 `.is-active`），关闭 / 新建用 `.vgo-button`，
  不新增 vgo 原语。
- 高亮：`.is-active` 只留 `--vgo-primary-opacity` 底色，去掉 `vgo-list-item.is-active` 自带的 1px outline
  （与侧边栏磁盘 / 收藏项一致）。
- 挤压不换行：容器 `flex-wrap: nowrap; overflow: hidden`，标签项 `flex: 1 1 auto; min-width: 2.5rem;
  max-width: 12rem`，标题省略号；标签之间不留空隙，用一条短分隔线区分（相邻两个都不是活动标签时才画）。
- 高度：标签项强制 `height/min-height: var(--vgo-control-md)`。`vgo-list-item` 的 `min-height` 是
  `control-lg`，不覆盖就会把顶栏撑得比 `explorer-header` 高。
- 高亮是圆角 + 主题色底、不带 outline。注意 `&__item` 只编译成 `.explorer-tabs__item`（不会带上
  `.explorer-tabs` 前缀，特异度 (0,3,0)），盖不住主题的 (0,3,1)，所以去掉 outline 的那条要显式再套一层父选择器。
- 无动画：不写 transition。
- 操作：单击切换、中键关闭、关闭按钮、`+` 新建（沿用当前标签的路径，**永远追加在最后**并激活）。
- 右键菜单：Close / Close others / Close to the left / Close to the right，都天然满足「至少保留 1 个」。
- 排序拖拽用自己的 MIME（`application/x-file-lite-tab`），插入下标按指针在标签左 / 右半边计算，
  插入线用 `::before` / `::after` 画（与收藏夹排序同一套写法）。
- **标签不是文件落点**：拖文件经过标签时只启动 1s 计时器，不调用 `preventDefault`，
  因此浏览器不会把标签当成合法落点；到点后切到该标签，用户再在内容区放下。
- 标签自己的排序拖拽与「文件经过标签」靠 MIME 区分，互不干扰。

## 5. 快捷键

| 快捷键 | 动作 |
| --- | --- |
| `Alt+T` | 新建标签（当前路径） |
| `Alt+W` | 关闭当前标签（只剩 1 个时无操作） |
| `Alt+1..9` | 跳到第 N 个标签 |

未使用 `Ctrl+T` / `Ctrl+W` / `Ctrl+Tab`：Chrome 把这几个保留给浏览器自身，页面收不到 `keydown`。
实现上没有走 `useShortcut`（那套按 scope 路由，标签操作属于外壳、要作用于活动标签），
而是在外壳直接监听 `keydown`，并排除输入框与已激活的 App 窗口。

## 6. 快捷键作用域（多标签的关键）

- 面板的 scope 是 `fileManager:<tabId>`（选择器仍是 `fileSelector`）。
- 外壳根节点 `.explorer-wrap` 的 `data-shortcut-scope` **动态指向活动标签的 scope**，于是：
  - 焦点在面板内 → `closest` 命中外壳属性，解析出活动标签的 scope；
  - 焦点在顶栏 / 侧边栏 → 同样命中外壳属性，仍然落到活动标签。
- 隐藏标签的注册还在，但它们的 scope 字符串与活动值不同，永远不会被命中，
  不必给几十处 `useShortcut` 逐个加 `disabled`。

## 7. 选择器模式

- `FileSelector` 不传 `tabsMode`，外壳走「选择器」分支：只渲染 1 个 `ExplorerPane`，
  路径用本地的 `NAV_PATH`，不读不写标签 store。
- 标签栏在 `FileLite` 的顶栏里，选择器窗口没有顶栏，天然没有标签栏。
- 选择器的右键菜单是 selection-only，`handleSelect` 契约不变。

## 8. 传输面板

- `<TransferQueue>` 全局只有一份，挂在顶栏（面板本身 Teleport 到 body）；面板从**顶栏右下角**出现，
  `top` 用 `--explorer-top-bar-height`（`styles/style.scss` 里的 `:root` 变量，顶栏自己也用它定高）。
- `ExplorerUI/transfer-queue-registry.ts` 保存那个唯一实例的 API；各标签的上传 / 下载入口往同一个队列塞任务。
- 上传管线与「系统文件拖入」的 sink 移到模块级：之前每个 `FileList` 注册一次 sink，多实例时后者会覆盖前者。
- 队列跑完一批后通过 `ExplorerEvents.TRANSFER_DONE` 广播，各标签自己按目录过滤后补丁自己的列表
  （不再由某一个列表绑定 `@all-done`）。

## 9. 测试覆盖

`e2e/tests/08-tabs.spec.ts`：

1. 新增 / 切换 / 保活 / 关闭 / 持久化（含「最后一个标签不能关」）。
2. 拖拽排序并持久化。
3. 拖文件悬停标签 1s 自动切换，且直接落在标签上不产生任何文件操作。
4. `Alt+T` / `Alt+数字` / `Alt+W` 快捷键。
5. 右键菜单的 Close to the right / Close others。

`helpers.ts` 的 `row()`、`currentCrumb()`、返回 / 复制 / 粘贴按钮定位都限定在 `.explorer-main:visible` 内，
否则保活标签里隐藏面板的同名元素会撞上 Playwright 的 strict mode。
