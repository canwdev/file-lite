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
2. `scripts/fixture.mjs`：重建干净的夹具目录与 `config.json`（固定密码、`safeBaseDir` 指向夹具）。
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
| `07-drag-drop.spec.ts` | 拖到文件夹行 / 面包屑 / 收藏夹 / 磁盘根 = 移动或复制（同卷移动、跨卷复制、Ctrl 复制）；文件夹不能拖进自己；拖动收藏项调整顺序并持久化；系统拖入文件上传到这些目录 | `07-drag-drop` |

合计 28 个用例，单次运行约 50 秒。

## 截图

`bun run test` 会顺便把截图写进 `screenshots/`（提交进仓库，供
[`../docs/frontend-ui-testing.md`](../docs/frontend-ui-testing.md) 引用）。
截图前会等待弹窗动画落定，并清掉历史任务，保证画面只反映当前用例。

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
│   └── install-browser.mjs   # 把 Chromium 装进 .browsers
├── tests/
│   ├── helpers.ts            # 登录、导航、复制/粘贴、截图等
│   └── *.spec.ts
└── screenshots/              # 文档用截图（提交）
```

> `scripts/fixture.mjs` 与 `scripts/start-app.mjs` 是分开的：测试代码要 import 夹具常量，
> 如果常量写在会启动服务的文件里，每个测试 worker 都会试图再起一个服务。
