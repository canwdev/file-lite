# File Lite E2E 测试子项目

用真实浏览器驱动**完整应用**（内嵌前端的 Go 二进制）的端到端 UI 测试。
覆盖本次「文件操作异步化」的全部用户可见行为：冲突弹窗、任务进度、取消、失败清单与重试。

独立的子项目（自己的 `package.json` / `node_modules`），不参与 `frontend` 的构建，
只依赖 `bun` + `go` + Playwright 的 Chromium。

## 快速开始

```sh
cd e2e

# 1) 安装依赖
bun install

# 2) 下载 Chromium 到项目内（不写 HOME，沙箱/CI 友好）
bun run install:browser

# 3) 跑测试（会先构建前端 + 编译后端，再启动服务）
bun run test
```

其它命令：

```sh
bun run build        # 只构建被测应用（前端产物 + 内嵌前端的 Go 二进制）
bun run test:headed  # 带界面跑，便于观察
bun run report       # 打开上一次的 HTML 报告
```

## 运行方式

`playwright.config.ts` 的 `webServer` 会执行 `scripts/start-app.mjs`：

1. `scripts/build-app.mjs`：`bun run build`（`vite build` + 打包成 `frontend-assets.tar.gz`）
   → `go build`。**必须两步都做**，因为后端用 `go:embed` 把那个 tar.gz 编进二进制，
   只跑 `vite build` 浏览器拿到的还是旧前端。
2. `scripts/fixture.mjs`：重建干净的夹具目录与 `config.json`（固定密码）。
3. 启动二进制，由 Playwright 轮询 `http://127.0.0.1:4173/api/` 判断就绪，测试结束后关掉。

所有可写的产物都在 `e2e/.file-lite-e2e/`（已 gitignore），
测试可以随意增删文件、改权限，不会碰到仓库里的任何东西。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `E2E_SKIP_BUILD` | 未设置 | 设为 `1` 时跳过构建，直接复用上一次的二进制（本地反复跑时省 20~30 秒） |
| `E2E_BULK_FILES` | `6000` | 「运行中取消」用例生成的小文件数量；复制耗时由文件数决定 |
| `E2E_PORT` | `4173` | 被测服务端口 |

## 用例覆盖

| 文件 | 覆盖内容 | 产出截图 |
| --- | --- | --- |
| `01-login.spec.ts` | 登录、侧边栏驱动器、进入子目录、返回 | `01-file-manager` |
| `02-copy-conflict.spec.ts` | 同名冲突弹窗；弹窗期间磁盘零改动；Cancel 取消并移除任务；Replace / Skip / Keep both；目录同名静默合并 | `02-conflict-dialog` |
| `03-upload-conflict.spec.ts` | 上传同名弹窗、Replace / Skip、新文件不弹窗 | `06-upload-conflict` |
| `04-task-progress.spec.ts` | 进度条与计数、运行中取消且不留半个文件、完成后面板自动收起、成功任务不留记录、任务跨窗口可见 | `04-task-progress` |
| `05-failure-retry.spec.ts` | 失败清单（哪一项、为什么、不泄露临时文件名）、Try Again 只重跑失败项 | `05-failure-dialog` |
| `06-download.spec.ts` | 浏览器最终保存的文件名（含 `+` 与空格）、文件夹下载的 zip 名 | — |
| `07-drag-drop.spec.ts` | 拖到文件夹行 / 面包屑 / 收藏夹 / 磁盘根 = 移动或复制（同卷移动、跨卷复制、Ctrl 复制）；Ctrl 拖回当前目录 = 原地复制；文件夹不能拖进自己；拖动收藏项调整顺序并持久化；系统拖入文件上传到这些目录 | `07-drag-drop` |
| `08-tabs.spec.ts` | 内置标签页的新增（追加在最后）/ 切换 / 保活 / 关闭 / 持久化；最后一个标签不能关；顶栏与工具栏等高；拖拽排序并持久化；右键 Close to the left / right / others；拖到另一个标签的内容区；拖文件悬停标签 500ms 自动切换且标签不接受落点；`Alt+T` / `Alt+数字` / `Alt+W` | — |
| `09-file-selector.spec.ts` | 选择器模式（打开服务器视频）：单面板、没有标签栏，选中后能返回 | — |
| `10-split-view.spec.ts` | 标签拆分视图：吸收右邻标签合并且只留一个关闭按钮；没有邻接时新建同路径面板；子菜单的交换视图 / 切换方向 / 取消拆分；总关闭按钮关掉两个面板；拆分随刷新保留；两个面板的 list/grid 与图标大小互不影响；跨面板拖文件；拖动分隔线调整大小 | — |
| `11-path-contract.spec.ts` | VFS 路径契约：面包屑第一段 = 挂载点根；下拉打开时高亮并滚动到当前目录；「上一级」在挂载点根停住；地址栏里各种写法（尾分隔符 / 连续斜杠 / 点段 / 父目录段 / 反斜杠）落到同一个目录；UNC 前导 `//` 不被折叠；加密未解锁的卷（BitLocker）显示锁图标并报系统原话；列目录失败时列表区显示原因 + Try again，404 与 503 不互相冒充；同目录刷新失败不顶掉已有列表 | `11-mount-breadcrumb`、`11-list-error` |

合计 56 个用例，单次运行约 95 秒。

## 截图

`bun run test` 会顺便把截图写进 `screenshots/`（**不入库**，见下）。
截图前会等待弹窗动画落定，并清掉历史任务，保证画面只反映当前用例。

`screenshots/` 里的图**不提交进仓库**（历史提交里仍有，不回删）：它们只是测试产物，
每次运行都会变，放进版本控制只会制造无意义的二进制 diff。目录里保留一个
`.gitignore`，这样新克隆出来的仓库里**有一个空的 `screenshots/`**，
测试直接往里写即可，也不会留下未跟踪的空目录。

> 与 README 功能表格用的截图要分清：那些是人工挑选的展示图，由
> `bun run docs:screenshots` 生成到 `../docs/screenshots/`，**仍然提交**。

## README 截图

README 功能表格里的截图由另一个脚本产出，输出到 `../docs/screenshots/`：

```sh
cd e2e
bun run docs:screenshots              # 内部会先构建应用；首次还要下载演示素材
E2E_SKIP_BUILD=1 bun run docs:screenshots   # 复用上一次构建的二进制
bun run docs:screenshots --only=01,04 # 只重截某几张
bun run docs:screenshots --refresh    # 重新下载演示素材
```

- 演示内容不碰测试夹具：`scripts/docs-fixture.mjs` 会在 `/tmp/file-lite-demo/` 下
  单独建一份「Pictures / Videos / Music / Media / Documents」演示库（可用 `E2E_DOCS_DIR` 改位置）。
  放 `/tmp` 而不是仓库里，是因为地址栏显示绝对路径，放仓库会把仓库路径印进截图。
- 素材（图片、视频、音频）来自 picsum.photos、download.samplelib.com 与
  test-videos.co.uk，下载后缓存在 `.samples/`（已 gitignore，可复用、不提交）；
  带封面和歌词的 mp3 由本机 ffmpeg 合成，歌词用脚本手工写入 USLT 帧
  （ffmpeg 只会写 `TXXX:USLT`，播放器读不到）。
- 服务端口默认 `4174`（测试是 `4173`），可用 `E2E_DOCS_PORT` 覆盖。
- `00-main.webp` 是手工精修的主图，脚本不会覆盖它。
- 每个功能点用独立的浏览器上下文截图，所以标签页、视图、滚动位置互不干扰。

## 排查

**`port 4173 is already in use`**
上一次运行被强杀留下了孤儿服务进程。测试脚本会直接报错退出（而不是让第二个服务悄悄起不来、
测试连到旧进程上）。清理：

```sh
pkill -x file-lite-go
```

**测试卡在构建阶段**
第一次构建是冷启动（`go build` 要编译全部依赖），约 30~60 秒；
之后可以 `E2E_SKIP_BUILD=1 bun run test` 跳过构建。
`webServer.timeout` 已设为 240 秒。

**用例一多就卡在登录页**
登录端点有「每 IP 每分钟 20 次」的限流。`helpers.ts` 的 `login()` 只在第一个用例走真实登录表单，
之后把拿到的 token cookie 写进新上下文（每个用例都是新上下文），因此整轮只打一次登录接口。

**断言偶发 ENOENT / 明明文件后来生成了却判失败**
`expect.poll` 的回调一旦**抛错就立刻失败、不会重试**（实测：4ms、只调用 1 次）。
所以「等异步操作落地」不能用 `fs.readFileSync` 直接抛 ENOENT，
要用 `helpers.ts` 里不抛错的 `readTextIfExists` / `fs.existsSync`。

**地址栏用例：编辑器打不开 / 只输入了一部分**
两个坑（见 `11-path-contract.spec.ts` 的 `openAddressBar`）：

1. 「点地址栏」**不**进编辑态——容器的 click 只在恰好落到 padding 上时才进编辑，
   而那个落点随路径长度变化。走 `Alt+A`（面板注册的快捷键）才可靠。
2. `Alt+A` 的作用域由 `event.target.closest('[data-shortcut-scope]')` 解析，
   所以焦点必须在 `.explorer-wrap` 内。**提交一次路径后焦点会落到 `<body>`**，
   此时快捷键静默失效，必须先 focus 回根节点（用 `page.evaluate` 直接 focus，
   `locator.focus()` 会走 actionability 检查而超时）。
3. `fill` 与 `Enter` 要分两次调用：编辑器刚打开时面包屑的溢出测量会在同一帧改布局，
   连在一起写 `fill` 会被打断、**只留下一部分字符**（实测面包屑显示成 `i`）。

**拆分视图里拖不动分隔线**
`page.mouse.*` 在这条用例里打不到 dragger 上：它只有 4px 宽，而且前面的落盘刷新会
让面板重排，`mousedown` 恰好落在重排的空档里（实测 dragger 上一个事件都收不到，
于是每个阶段量到的宽度完全相同，看起来像「拖动无效」）。
`el-splitter` 监听的就是 dragger 上的 `mousedown` + window 上的 `mousemove` / `mouseup`，
所以用例改成直接按事件派发，既确定又不需要命中 4px 的目标。

**构建阶段报 `spawn EINVAL` / `Executable doesn't exist`**
前者是 Windows 上 `spawn` 无法直接执行 `.cmd` 垫片——`run-tests.mjs` 与
`install-browser.mjs` 已改成用 `node` 跑 Playwright 的 `cli.js`，与平台无关。
后者是浏览器没装：`bun run install:browser`（装进项目内的 `.browsers`）。

**改了前端却没生效**
先确认 `bun run test`（而不是 `E2E_SKIP_BUILD=1`）——只有完整构建才会更新
`backend-go/frontend-assets.tar.gz`。

## 目录

```
e2e/
├── playwright.config.ts      # 视口、串行执行、webServer
├── scripts/
│   ├── build-app.mjs         # 前端 → tar.gz → Go 二进制
│   ├── fixture.mjs           # 夹具常量与重建（无副作用，测试代码也会 import）
│   ├── start-app.mjs         # webServer 入口：建夹具 + 起服务
│   ├── run-tests.mjs         # 跨平台入口，固定浏览器目录
│   ├── install-browser.mjs   # 把 Chromium 装进 .browsers
│   ├── docs-assets.mjs       # README 截图的免费素材下载与 mp3 合成
│   ├── docs-fixture.mjs      # README 截图的演示库
│   └── capture-docs.mjs      # README 截图入口，输出到 ../docs/screenshots
├── tests/
│   ├── helpers.ts            # 登录、导航、复制/粘贴、截图等
│   └── *.spec.ts
├── .samples/                 # 素材下载缓存（gitignore，可复用）
└── screenshots/              # 测试文档用截图（提交）
```

> `scripts/fixture.mjs` 与 `scripts/start-app.mjs` 是分开的：测试代码要 import 夹具常量，
> 如果常量写在会启动服务的文件里，每个测试 worker 都会试图再起一个服务。
