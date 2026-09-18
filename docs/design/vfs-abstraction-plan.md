# VFS 抽象层实现计划与测试清单

## 状态：阶段 1–5 已实现

分支 `dev/next`，版本仍是 **1.5.0**（未发布），**都没有 push**。提交顺序：

| 提交 | 内容 |
| --- | --- |
| `84160bf` | `refactor: add the canonical VFS path rules`（阶段 1） |
| `d451929` | `feat: drop safeBaseDir and add startPath`（阶段 2） |
| `d699cf0` | `fix: list only real drives, with capacity, on Linux` |
| `fbc9a62` | `feat: add the mount table and path resolver`（阶段 3 纯逻辑） |
| `0e5c9b5` | 侧边栏图标 + 交接说明 |
| `f2a2638` | 4 个 Windows 不友好的测试夹具改为平台无关 |
| `993fb38` | `feat: route every file operation through the VFS resolver`（阶段 3） |
| `618fa42` | `feat: make the frontend path handling UNC-safe and mount-driven`（阶段 4） |

**仍然没做的**：E2E 用例（§5.4 的清单，AGENTS.md 要求用户明确要求才加），
以及只能在真机上做的验证（§5.5 手工验证、§8 的 Windows 清单）。

下面是阶段 1–5 的实现记录与踩坑汇总。

## 交接说明（给下一个会话）

> 本节是跨会话的交接点。上次会话在 **WSL2 的 Linux** 上完成，开发环境即将迁到
> **原生 Windows**，会话会重新开始——先读这一节，再读下面的实现记录。

### 仓库状态

- 分支 `dev/next`，版本仍是 **1.5.0**（未发布）。
- **都没有 push**。截至写这份交接时的提交（用 `git log --oneline` 看最新状态）：

  | 提交 | 内容 |
  | --- | --- |
  | `84160bf` | `refactor: add the canonical VFS path rules`（阶段 1） |
  | `d451929` | `feat: drop safeBaseDir and add startPath`（阶段 2） |
  | `d699cf0` | `fix: list only real drives, with capacity, on Linux` |
  | `fbc9a62` | `feat: add the mount table and path resolver`（阶段 3 纯逻辑） |
  | 其后一次 | 侧边栏图标（home / network folder）+ 本交接说明 |

- 交付约定：**完成即可提交，不要 push**。
- 提交信息用英文 `type: subject`，正文用中文说明「为什么」。

### 怎么跑测试（务必先看这条）

```bash
cd backend-go && GOCACHE=$PWD/.gocache go build ./... && GOCACHE=$PWD/.gocache go test ./...
cd frontend   && bun test && bun run type-check && bun run lint
cd e2e        && node scripts/run-tests.mjs tests/01-login.spec.ts   # 只跑受影响的 spec
```

- **沙箱里 `go test` 会因为 `$HOME/.cache/go-build` 不可写而失败**，用
  `GOCACHE=$PWD/.gocache` 覆盖；跑完记得 `rm -rf backend-go/.gocache`（它没有进 .gitignore）。
- e2e 会重新构建前端 + 后端、并**重新生成截图**，约 30–60 秒。改了前端或路由就值得跑一次
  受影响的 spec；整套只在被要求时跑。
- `e2e/` 的夹具依赖 `config.startPath`，盘列表由 `tests/helpers.ts` 的
  `stubFixtureMounts()` 在测试侧接管（真实盘列表是整个文件系统，不能当测试根）。

### 已实现（不要重复做）

- **阶段 1**：`fileops/vfs_path.go` 的 canonical 规则，前端副本 `canonical-path.ts`，
  两边同一张表驱动测试。
- **阶段 2**：`safeBaseDir` / `IsPathSafe` 已整体删除；`startPath` 取代"首个标签打开哪里"。
- **驱动器列表修复**：`drives_linux.go` 过滤伪文件系统与 WSL 内部挂载、按设备去重、
  用 statfs 提供容量；`types.Drive` 增加 `kind`（volume/network/home）。
- **阶段 3 纯逻辑**：`fileops/mount.go` 的挂载表、`LongestMount`、`Resolve`、
  `NetworkPath`、`SamePath`、canonical 的 `BaseName`/`DirName`；
  边界处 `canonicalVFS()` 归一化；`enumerateDrives()` 与挂载表共用一份枚举。

### 下一步：按这个顺序做

1. **调用点迁移到 `Resolve`**（可在 Linux 完成，但有行为变化，需要同步改测试）
   - 目标：`getFiles` / `createDirectory` / `renamePath` / `getFileStream` /
     `downloadPath` / `uploadFile` / `existsPaths` 统一走 `fileops.Resolve`。
   - **已知的行为变化**：非法路径的错误码从下游的 500/404 变成 400（相对路径、越根）。
     每个变化都要在提交信息里说明，并更新 `routes/*_test.go` 里相应的期望。
   - 目前只做了归一化（失败时原样返回），所以错误语义没变——这是刻意留的。
2. **并发档位**（可在 Linux 完成）
   - `readDirStatConcurrency`（`routes/files.go`）按挂载点 `Kind` 取值：卷 64、网络 4–8。
   - 真实效果只能上 SMB 才看得出来（见"Windows 上必验"）。
3. **网络错误的 502/503 映射**（逻辑可在此写，真实表现要 Windows）
   - 「服务器不可达 / 超时」不得与「文件不存在」的 404 混为一谈。
4. **阶段 4 前端**（UNC 相关的部分留到 Windows，其余可在 Linux 做）
   - `normalizePath`（`FileManager/utils/index.ts`）**豁免 UNC 前导 `//`**——
     这是当前唯一会破坏数据的函数，也是所有前端改动里优先级最高的一条。
   - `canGoUp` / `getParentPath` / `AddressBar` 面包屑改为**挂载点驱动**（第一段 = 挂载点根）。
   - `drives.ts` 的 `resolveVolumeRoot` 加**段边界**检查（`/data2` 不得匹配 `/data`）。
   - 起始状态：不再默认 `/`，未选中位置时列表区显示挂载点列表。
5. **阶段 5**：文档与 CHANGELOG 收尾。注意 `docs/config.md` 已改过，
   `safeBaseDir` 不该再作为"现存字段"出现。

### Windows 上必须验证的清单（换环境后优先做）

- **UNC 读写**：`\\<主机>\<共享>` 能列目录、打开、预览、下载、重命名、删除；
  断网/共享离线时错误可读且可重试（对应上面第 3 项）。
- **WSL 路径**：`\\wsl.localhost\<发行版>\...` 同上。
- **地址栏**：粘贴 `C:\Users\...` 能被识别；`\\server\share` 的前导 `//` 不被折叠；
  面包屑第一段是挂载点根，"上一级"到根为止。
- **映射盘符**：在资源管理器映射一个共享为 `Z:`，确认它出现在侧边栏且归类正确。
- **`GetDriveType`**：把 `DRIVE_REMOTE` 标成 `network`（当前 Windows 侧只补了 `kind`，
  没有区分远程盘符）。
- **网络路径的并发**：千文件目录的列表加载时间，对比卷档位（验证第 2 项是否有效）。
- **属性窗口**：`utils.BirthTime` 在 UNC/WSL 上拿不到时回落 mtime。
- **e2e**：在 Windows 上补 UNC/面包屑相关的用例（上次会话刻意没加平台相关用例）。

### 仍然有效的约束

- `AGENTS.md`：前端改动跑 `bun run lint` / `type-check`；后端改动跑相邻 Go 测试；
  **不要主动新增或运行 e2e**，除非用户要求或改动大到读代码不够。
- 版本号要在 `frontend/src/enum/version.ts` 与 `backend-go/config/config.go` 同步；
  1.5.0 尚未发布，所以本次的功能都记在 `## 1.5.0` 段内。
- 新图标名必须注册进 `mdiIconRegistry`（`frontend/src/utils/icons.ts`），
  否则静默回落成问号图标。

### 已知的取舍与待决项

- **ZIP 只读 VFS 不做**。将来若做，形态是**纯路径前缀**：`D:/Downloads/temp.zip/temp/videos`
  （`.zip` 只是普通路径段，由挂载表赋予语义），不引入 scheme。
- **reparse 点（junction/symlink）**：`filepath.Abs` 不解析它们，
  因此"父路径是链接"的兄弟目录判重是词法判断的盲点（不是可利用的绕过）。
- **cifs 挂载的容量**：本机没有 cifs 挂载可验，`statfs` 在 cifs 上多半拿不到容量，
  届时会走"没有容量就不显示"的降级路径——在真实 NAS 上确认一下。
- **`fstype` 变化**：macOS 的 SMB 相关实现不经过 `drives_linux.go`（`//go:build linux`），
  非 Linux 的 Unix 目前只返回根，这是有意的降级。

---

> 状态：**阶段 1、2 已实现，阶段 3 的纯逻辑部分已实现**；阶段 3 剩余项与 4、5 待实现。
>
> - 阶段 1（canonical 规则，纯新增）见下方实现记录。
> - 阶段 2（删 `safeBaseDir` / `IsPathSafe`，加 `startPath`）见下方阶段 2 记录。
> - 阶段 3 的挂载表 / Resolver / 边界归一化见下方阶段 3 记录；
>   **调用点迁移只做了零风险的那一半**——批量改走 `Resolve` 会改变非法路径的错误码
>   （相对路径 500 → 400），那是行为变化，单独一步做。
> - E2E 仍暂缓：开发机是 Linux，UNC/WSL 无法完整验证，等迁到 Windows 开发机再做。
>   本次只改夹具与既有用例，未新增平台相关测试。
>
> 设计依据见 [`vfs-abstraction-design.md`](./vfs-abstraction-design.md)，
> 本文只讲**怎么做、注意什么、测什么**。
>
> 总原则：**先用测试把 canonical 规则钉死，再动调用点。** 规则一旦生效就没有回头路，
> 而它是纯函数，可以在不改任何行为的前提下先落地并被完全覆盖。

## 阶段 1 实现记录

| 产物 | 说明 |
| --- | --- |
| `backend-go/fileops/vfs_path.go` | `CanonicalizePath`、`ComparisonKey`、`IsWithinRoot`、`splitRoot`、`cleanSegments`，以及 `ErrPathNotAbsolute` / `ErrPathMalformed` / `ErrPathEscapesRoot` |
| `backend-go/fileops/vfs_path_test.go` | 表驱动，覆盖设计文档 §4.2 全部规则 + 幂等性 |
| `frontend/src/views/FileManager/utils/canonical-path.ts` | 同一契约的前端副本（`canonicalizePath` / `comparisonKey` / `isWithinRoot` / `splitRoot` / `PathError`） |
| `frontend/src/views/FileManager/utils/canonical-path.test.ts` | 与后端同一张表，用 `bun test` 运行 |
| `frontend/env.d.ts` | `bun:test` 的最小类型声明（不引入 `bun-types`，避免为此新增 devDependency） |
| `frontend/package.json` | 新增 `test` 脚本（`bun test`） |

**两份实现、两份测试，是刻意的决定**：前端需要能本地做乐观显示，所以规则必须在它那边
可用；同一张表两边各跑一遍，是发现"两份实现漂移"的唯一廉价手段。阶段 1 就抓到一个实例——
前端用不限制段数的 `split('/')` 取 UNC 余下部分，在 4 段以上的路径（如
`//wsl.localhost/Debian/home/me`）会**静默丢掉深层路径**，而 Go 的 `SplitN(...,3)` 写法
恰好掩盖了同类问题。两边现在都有 4 段以上的用例。

**验证命令**：

```bash
cd backend-go && GOCACHE=<可写目录> go test ./...      # 全仓 Go 测试
cd frontend && bun test && bun run type-check && bun run lint
```

> 若 `go test` 报 `permission denied` 于 `/home/<user>/.cache/go-build`，
> 用 `GOCACHE=<工作区内的可写目录>` 覆盖即可（沙箱/CI 环境常见）。

## 阶段 2 实现记录

| 改动 | 说明 |
| --- | --- |
| 删除 `safeBaseDir` | `Cfg` 字段、全局变量、`SafeBaseDir()`、默认值 `"./"`、以及原 `:194-211` 整段（含「按需创建受限根」） |
| 删除 `IsPathSafe` | `fileops/path.go` 中的实现 + `routes/files.go` 的 `isPathSafe` 包装 + 9 个调用点（`routes/files.go`、`routes/thumbnail.go`、`routes/properties_ws.go`、`tasks/manager.go`、`fileops/scan.go`、`fileops/ops.go`） |
| 新增 `startPath` | 配置字段 + `resolveStartPath()`（可单测的纯函数）+ `GET /api/files/start` + 前端 `loadStartPath()` / `configuredStartPath`；首次打开优先进入它，否则打开第一个盘 |
| `getDrives` | 删掉「设了 `safeBaseDir` 就只返回它一个盘」的特例 |
| 保留 | `utils.IsPathInsideOrEqual` 及其两个调用点（见下方更正） |
| e2e | 夹具改用 `startPath`；盘列表由 `tests/helpers.ts` 的 `stubFixtureMounts()` 在测试侧接管——真实盘列表是整个文件系统，不适合当测试根 |

### 一处计划外的更正：符号链接那个判断是错的

原计划写的是「`IsPathInsideOrEqual` 现在没解析符号链接，软链接可绕过，本次顺手修掉」。
动手前验证发现**这个判断不成立**：

`filepath.Abs` 已经折叠了 `.` 与 `..`，所以唯一能让「词法上在源内」与「实际指向在源外」
分叉的情况是**源路径自身含符号链接**——而那时字符串前缀判断与实际指向**恰好一致**
（链接在源目录内 ⇒ 链接下的路径也在源目录内，两者同时成立或同时不成立）。

一度实现了「逐级向上 `os.Stat` + `os.SameFile`」的祖先解析，但用探针验证后发现
它对任何输入都不会改变结果（死代码），于是撤掉，只保留词法判断并补上注释与用例，
把唯一真实的例外写清楚：**不区分大小写的文件系统**上 `SRC` 与 `src` 是同一个目录，
这里按不同字符串处理；Windows 上 `os.Rename` 自己会拒绝，因此不折叠大小写
（折叠反而会在大小写敏感的平台上把两个不同目录误判成同一个）。

## 阶段 3 实现记录（纯逻辑部分）

| 产物 | 说明 |
| --- | --- |
| `fileops/mount.go` | `Mount`、`SetMounts` / `GetMounts`、`LongestMount`（纯函数）、`Resolve`、`NetworkPath`、`SamePath`、`BaseName` / `DirName` |
| `fileops/mount_test.go` | 挂载点归一化、最长前缀 + **段边界**、解析（含「未匹配挂载点仍可用」）、canonical 的 Base/Dir |
| `routes/mounts_test.go` | 钉住「侧边栏的盘」与「解析器的挂载点」来自同一份枚举结果 |
| `routes/files.go` | `enumerateDrives()` 抽出来，`getDrives` 与启动时的 `SetMounts` 共用；新增 `canonicalVFS()` 在边界归一化 |

### 两个在实现中纠正的设计错误

1. **挂载点不必是语法意义上的根**。最初写成「挂载点必须是 `/`、`C:/`、`//host/share`」，
   结果 Linux 的 `/mnt/dev-drive` 被拒——它确实是挂载点。**边界由挂载表决定，不由路径语法决定**，
   所以只要求「合法的绝对路径」。
2. **`DirName` 是词法操作**。最初想让它在挂载点根停住，但那是「界面能不能往上退」的问题，
   该由前端 + 挂载表决定（`LongestMount` 已提供依据）。写成挂载感知会让第 3 阶段的分层变形，
   而且当前没有调用点需要那个语义。

### 顺带修掉的跨平台缺陷

canonical 路径统一用 `/`，而 `filepath.Base`/`filepath.Dir` 在 Windows 上只认 `\`——
`filepath.Base("C:/Users/a.txt")` 会把整条路径当成文件名。原先这是潜在问题（路径来自
`os.ReadDir` 的名字，不含分隔符，所以看不出错），一旦边界开始归一化就会真的出错。
处理 wire 路径的地方（`files.go`、`thumbnail.go`、`fs_changes.go`、`tasks_ws.go`）已改用
`fileops.BaseName` / `fileops.DirName`。

### 阶段 3 剩余项

- **调用点迁移到 `Resolve`**：`getFiles` / `createDirectory` / `renamePath` / `getFileStream` /
  `downloadPath` / `uploadFile` / `existsPaths` 的错误码会变（非法路径 400 而不是下游的
  500/404）。这是行为变化，单独一步做，并同步既有测试。
- **并发档位**：`readDirStatConcurrency` 按挂载点 `Kind` 取 64 / 4–8。
- **网络错误的 502/503 映射**：与 404 区分开。
- **Windows 盘符的 `Kind`**：`GetDriveType == DRIVE_REMOTE` 标 `network`——需要原生 Windows 验证。


## 0. 改动地图

| 区域 | 文件 | 改动 |
| --- | --- | --- |
| 配置 | `backend-go/config/config.go` | 删 `SafeBaseDir` 字段/全局变量/解析分支（`:41,58,99,130,194-211`） |
| 路径 | `backend-go/fileops/path.go` | 删 `IsPathSafe`；`Clean`/`samePath` 改为 canonical 语义 |
| 路径（新） | `backend-go/fileops/vfs_path.go`（新文件） | `canonicalizePath`、比较键、边界校验 |
| 挂载（新） | `backend-go/fileops/mount.go`（新文件） | `Mount`、挂载表、最长前缀解析、`Resolve` |
| 后端（新） | `backend-go/fileops/backend.go`（新文件） | `Backend` 接口、`Caps`、local 实现 |
| 文件操作 | `backend-go/fileops/ops.go:111,129` | 去掉 `IsPathSafe`，改走 `Resolve` |
| 扫描 | `backend-go/fileops/scan.go:40` | 同上 |
| 任务 | `backend-go/tasks/manager.go:183,197,205` | 同上；`IsPathInsideOrEqual` 检查改为解析后比较 |
| 路由 | `backend-go/routes/files.go:55,124,143,187,265,315,409,474` | 改走 `Resolve`；`getDrives` 重写；并发按档位 |
| 路由 | `backend-go/routes/fs_changes.go:58,67,74` | 父目录用 `path.Dir`（canonical），不再用 `filepath.Dir` |
| 路由 | `backend-go/routes/properties_ws.go:89,127` | 路径经 `Resolve`；`EvalSymlinks` 保持后端行为 |
| 缩略图 | `backend-go/thumbnails/thumbnails.go:198,260`、`video.go:158` | 接收已解析的 OS 路径，逻辑不变 |
| 盘符 | `backend-go/utils/drives_windows.go` | 加 `GetDriveType` → 区分 `volume` / `network`；`Path` 用 canonical |
| 类型 | `backend-go/types/types.go:15` | `Drive` 加 `Kind` |
| 前端 | `frontend/src/types/server.ts:14` | `IDrive` 加 `kind` |
| 前端 | `frontend/src/views/FileManager/utils/index.ts` | `normalizePath` 豁免 UNC 前导 `//`；`canGoUp`/`getParentPath` 改挂载点驱动 |
| 前端 | `frontend/src/views/FileManager/ExplorerUI/AddressBar.vue:26-59` | 面包屑第一段 = 挂载点根 |
| 前端 | `frontend/src/views/FileManager/ExplorerUI/drives.ts:56` | `resolveVolumeRoot` 加段边界 |
| 前端 | `frontend/src/views/FileManager/ExplorerUI/FileSidebar.vue:39` | 图标改看 `kind` |
| 前端 | `frontend/src/views/FileManager/ExplorerUI/hooks/use-navigation.ts:37` | 去掉默认 `'/'`，改为「未选中」状态 |
| 文档 | `docs/config.md:27,44,50,56`、`docs/design/thumbnails.md:17`、`docs/design/async-file-operations-ws-design.md:337`、`docs/design/frontend-ui-testing.md:29`、`e2e/README.md:39` | 删除 `safeBaseDir` 描述 |
| 测试夹具 | `e2e/scripts/fixture.mjs:74`、`e2e/scripts/docs-fixture.mjs:86,162` | 去掉 `safeBaseDir`（见 §3.4） |
| 版本 | `frontend/src/enum/version.ts`、`backend-go/config/config.go` | 用户可见变更，按 `CHANGELOG.md` 记一条（backend / frontend） |

> 注意：`backend-go/file-lite/config.json` 与 `backend-go/tmp/tlscheck/config.json` 是运行期
> 生成的文件，不在本次改动范围，但确认它们不会因此启动失败（未知字段被忽略）。

## 1. 阶段 1：路径规则先落地（零行为变更）

**目标**：canonical 规则成为可执行契约，且此时不改变任何现有行为。

- [ ] 新增 `fileops/vfs_path.go`：`canonicalizePath`（设计文档 §4.3）、
      `comparisonKey`（§4.4）、`isWithinRoot(p, root)`（段边界，不是裸 `HasPrefix`）。
- [ ] `canonicalizePath` 的**唯一依赖**是 `path` + `strings`，禁止出现 `filepath`。
- [ ] 前端新增等价实现（建议 `FileManager/utils/canonical-path.ts`），
      与后端逐条对齐设计文档 §4.2 的规则表。
- [ ] 两份实现都按 §4.2 的 16 条规则 + 非法输入建表测试（见 §4.1）。

**危险点**：
- 不要用 `path.Clean` 直接清带前缀的路径（吃 `//`）。
- 不要把 `C:` 当作 canonical（那是相对路径）。
- 不要改大小写、不要做 Unicode 归一化、不要解析符号链接。

## 2. 阶段 2：删除 `safeBaseDir` 与 `IsPathSafe`

**目标**：字段与函数彻底消失，为 resolver 腾出位置。

- [x] `config.go`：删字段、全局变量、`SafeBaseDir()`、默认值 `"./"`、`:194-211` 整段
      （含"按需 MkdirAll 受限根"的逻辑）。
- [ ] `fileops/path.go`：删 `IsPathSafe`（已完成）；`Clean` 改为调用 `canonicalizePath`、
      `samePath` 改为 canonical 比较 + 后端 `CaseSensitive` 判断——**推迟到阶段 3**，
      因为此刻还没有后端能力声明，改了反而要写两遍。
- [x] 删除 9 个调用点：`routes/files.go:55`、`tasks/manager.go:183,197`、
      `fileops/scan.go:40`、`fileops/ops.go:111,129`，另加 `thumbnail.go`、
      `properties_ws.go` 两处。
- [x] **保留** `utils.IsPathInsideOrEqual`（`utils/fs.go`）及其两个调用点
      （`routes/files.go:265`、`tasks/manager.go:205`），补注释与用例。
      原计划的"修符号链接绕过"经核实不成立，见上方更正。
- [x] 启动输出增加一行访问范围提示（`config.go` 的 `LoadConfig`）。
- [x] `docs/config.md` 删除该字段并说明变更（旧配置里的该字段会被忽略）。
- [x] e2e 夹具改用 `startPath`，盘列表在测试侧接管（§3.4 方案 A）。

**危险点**：
- 兼容性：旧 `config.json` 含 `safeBaseDir` 时必须正常启动（`json.Unmarshal` 默认忽略未知字段，
  确认没有 `DisallowUnknownFields`）。
- `e2e/scripts/fixture.mjs:74` 与 `docs-fixture.mjs:86,162` 靠该字段把夹具目录变成"根"，
  删掉后夹具与 `01-login` 的行为会变（§3.4 处理）。

## 3. 阶段 3：挂载表与 Resolver

### 3.1 挂载表

- [ ] `fileops/mount.go`：`Mount{Kind, Path, Label, Backend}`、`Resolve(p)`、
      `ListMounts()`。
- [ ] 匹配规则：**最长前缀 + 段边界**。`/data2` 不得匹配挂载点 `/data`；
      `//server/share/doc` 不得匹配 `//server/share2`。
- [ ] 未匹配到挂载点时：绝对路径仍走 local 后端（它覆盖整个文件系统），
      但运行时档位按 §5.3 判为 `network`（UNC 形态或不在本机已知卷上）。
- [ ] canonical 折叠后出现 `..` 逃逸 → 返回 400，错误信息不得回显完整路径。

### 3.2 调用点迁移

- [ ] `routes/files.go`：`getFiles`、`createDirectory`、`renamePath`、`getFileStream`、
      `downloadPath`/`downloadMulti`、`uploadFile`、`existsPaths` 全部改走 `Resolve`。
- [ ] `routes/fs_changes.go`：父目录与 basename 用 `path.Dir`/`path.Base`（canonical），
      **不要**用 `filepath.Dir`（非 Windows 上对 `C:\...` 返回 `"."`）。
- [ ] `tasks/manager.go`：`Create` 时解析所有 `fromPaths`/`toPath`；
      跨挂载的 move/delete 在本次范围外（只有 local 后端），保持现有行为。
- [ ] `fileops/ops.go`、`scan.go`：内部不再判安全，改为消费已解析的路径。

### 3.3 并发与错误映射

- [ ] `readDirStatConcurrency` 改为按挂载点档位取值：`local` 64、`network` 4–8。
- [ ] 网络档位的「服务器不可达 / 超时」映射为 502/503（前端可重试），
      **不得**与「文件不存在」的 404 混为一谈。
- [ ] `getDrives` 重写：删掉 `config.SafeBaseDir() != ""` 的三行特例
      （`files.go:124-126`），返回带 `Kind` 的挂载点列表；Home 仍是第一项。
- [ ] Windows 盘符：`GetLogicalDriveStringsW` 枚举后按 `GetDriveType`
      把 `DRIVE_REMOTE` 标为 `network`；`Path` 返回 canonical（`C:`、`Z:`，无尾斜杠）。
- [ ] `Free`/`Total` 拿不到就给 `nil`；**不要**为拿容量去逐个探测共享。

### 3.4 E2E 夹具（必须先定，否则阶段 3 会卡住）

删掉 `safeBaseDir` 后，夹具无法再把 `filesDir` 变成"根"，而测试期望登录后直接看到
`source` / `target` / `empty`。两种处置，**建议 A**：

- **A（推荐）**：新增配置字段 `startPath`（string，缺省空 = 显示挂载点列表），
  启动时作为首个窗口的初始目录。夹具设为 `filesDir`，`01-login.spec.ts` 只说
  「打开 `startPath`」而不是「`safeBaseDir` 对应的驱动器」。
  这也是自托管用户的真实需求（固定默认目录），不是为测试造的实体。
- **B**：夹具不改，测试靠"从盘符根逐级导航到夹具目录"到达，路径依赖工作目录，脆弱。

无论选哪个，都要同步更新 `e2e/README.md:39` 与 `01-login.spec.ts:8` 的注释。

## 4. 阶段 4：前端

- [ ] `normalizePath`（`utils/index.ts:1`）**豁免 UNC 前导 `//`**：先记住是否以 `//` 开头，
      折叠其余部分后再拼回。这是当前唯一会**破坏数据**的函数。
- [ ] `canGoUp` / `getParentPath`（`utils/index.ts:18,25`）改为挂载点驱动：
      停点是挂载点根，不是"段数为 1"。
- [ ] `AddressBar.getBreadcrumbSegments`（`AddressBar.vue:26`）：第一段 = 挂载点根，
      删掉「`trimmed === '/'`」与 `isUnix` 二分法。
- [ ] `drives.ts:56` `resolveVolumeRoot` 加段边界检查。
- [ ] `FileSidebar.getIcon`（`:39`）改看 `kind`；新增的网络/WSL 图标名必须注册进
      `mdiIconRegistry`（`utils/icons.ts`），否则静默回落成问号图标。
- [ ] `use-navigation.ts:37-38` 与 `utils/navigation-history.ts:25` 去掉默认 `'/'`，
      改为「未选中位置」状态（列表区显示挂载点列表）。
- [ ] 前端可做乐观显示，但**不做权威解析**，不实现第二套 canonical 规则。

## 5. 测试清单

### 5.1 Go 单元测试（新增）

**`fileops/vfs_path_test.go`** — `canonicalizePath` 表驱动，覆盖设计文档 §4.2 全部 16 条：

| 用例 | 期望 |
| --- | --- |
| `C:\Users\me\a.txt` | `C:/Users/me/a.txt` |
| `C:\` / `C:` | `C:/` |
| `C:/Users/` | `C:/Users` |
| `\\server\share` | `//server/share/` |
| `\\server\share\docs\` | `//server/share/docs` |
| `\\wsl.localhost\Debian\home\me` | `//wsl.localhost/Debian/home/me` |
| `/home/me/../other` | `/home/other` |
| `/data/../../etc` | 拒绝 |
| `//server/share/../..` | 拒绝 |
| `//server//share//docs` | `//server/share/docs` |
| `D:/Downloads/temp.zip/temp/videos/` | `D:/Downloads/temp.zip/temp/videos` |
| `c:/Users` | `c:/Users`（不改大小写） |
| `./foo`、`foo`、`` | 拒绝 |
| `/data/a+b#c?.txt` | 原样 |
| `/data/a\b.txt` | 原样（Unix 不转反斜杠） |
| `/data/é.txt` | 原样（不做 NFC/NFD 归一化） |

**`fileops/mount_test.go`** — 解析与边界：

- 最长前缀：挂载点 `C:`、`C:/Users` 同时存在时，`C:/Users/me` 归后者；
- **段边界**：`/data2/x` 不匹配挂载点 `/data`；`//server/share2` 不匹配 `//server/share`；
- 未匹配挂载点的绝对路径仍可解析（local）；
- 比较键：`c:` 与 `C:` 同键；`//SERVER/share` 与 `//server/share` 同键；
  但 `//server/SHARE` 与 `//server/share` **不同键**（共享名敏感）；
- 逃逸：`C:/Users/../../x` → 拒绝。

**`fileops/backend_test.go`** — local 后端：

- `Stat`/`ReadDir`/`Open` 的 `osPath` 由 `filepath.FromSlash` 生成；
- 只读能力上报正确（local 全部为 `true`）；
- `Open` 返回的 reader 可 `Seek`（缩略图依赖，`thumbnails.go:319`）。

**`routes/files_test.go`（或就近）** — HTTP 层：

- `..` 逃逸 → 400；
- 未匹配挂载点的绝对路径仍可用（回归：删除 `IsPathSafe` 后不能误拒）；
- 不存在的路径 → 404（网络不可达则 502/503，两者不得混淆）；
- `rename` 把目录移进自己的子目录 → 拒绝（含**软链接指向祖先**的用例）；
- `getDrives` 返回的每项都有 `kind`，`home` 为第一项。

### 5.2 既有 Go 测试（必须保持全绿）

- `fileops/ops_test.go`、`fileops/bench_test.go`、`fileops/crossdev_test.go`、
  `fileops/measure_test.go`、`tasks/manager_test.go`、`routes/upload_test.go`、
  `routes/download_test.go`、`routes/fs_changes_test.go`、`routes/properties_ws_test.go`、
  `routes/thumbnail_test.go`。
- `routes/upload_test.go:19` 的注释提到"safeBaseDir 为空、IsPathSafe 放行任意路径"，
  随改动更新（测试本身应仍通过）。
- `canonicalizePath` 的 Windows 语义（`\`→`/`、盘符）可用**注入根前缀**的方式在普通
  单测里覆盖；确需真实平台的用例放 `//go:build windows` 文件，避免在 Linux CI 上跳过。

### 5.3 前端单元测试

前端原本**没有任何测试基建**（只有 `type-check` 与 `lint`）。本次采用 **bun 内置的 `bun:test`**
（零依赖，仓库本来就用 bun）：

- 运行：`cd frontend && bun test`（`package.json` 已加 `test` 脚本）；
- 类型：`bun:test` 的声明放在 `env.d.ts`，**不引入 `bun-types`**；
  用到新 API 时按需补声明（若将来测试铺开，再考虑换成官方类型包）；
- 命名：测试放在被测模块旁边（`canonical-path.test.ts`）。

必须覆盖的用例：

- `normalizePath('\\\\server\\share\\docs')` → `//server/share/docs`
  （**前导 `//` 必须活着**，这是本次最重要的回归点）；
- `normalizePath('/data//x/')` → `/data/x`（其余仍折叠）；
- `resolveVolumeRoot('/data2/x')` 在挂载点含 `/data` 时返回 `null` 或 `/`，**不得**返回 `/data`；
- `canGoUp('D:/')` === false；`canGoUp('//server/share/')` === false；
- `getParentPath('//server/share')` 不越过共享根；
- 面包屑：`D:/Downloads/x` 第一段是 `D:/`；`//server/share/docs` 第一段是 `//server/share/`。

### 5.4 E2E（**本次不做**）

**决定：暂缓到迁到 Windows 开发机之后**——UNC / WSL 在 Linux 上无法完整验证，
现在写只会得到一套在真实平台上证明不了什么的用例。本次改动不碰 `e2e/`。

以下是**将来在 Windows 上做 E2E 时**必须处理的既有用例与建议新增项，先记在这里：

**必须更新的既有用例**：

- `e2e/tests/01-login.spec.ts:8`：注释与断言依赖 `safeBaseDir`，随 §3.4 的选择调整。
- `e2e/tests/07-drag-drop.spec.ts:152-159`：mock 了 `/api/files/drives` 的响应体并点
  `Reload drives`。若 `IDrive` 增加 `kind`，检查 mock 数据是否需要补字段
  （缺字段应能容错，不要因 mock 而误判实现有问题）。

**建议新增（针对本次真正的交互契约）**：

1. **多斜杠路径的往返**：在地址栏输入含连续斜杠的路径（如 `//server/share` 形态或
   `/data//x`），提交后检查发起请求的 `path` 参数与面包屑——验证前端没有折叠 UNC 前缀、
   后端按 canonical 解析；
2. **面包屑第一段 = 挂载点根**：点第一段回到根，且根状态下「上一级」不可用；
3. **侧边栏点击盘符**：进入该卷根，且根状态的面包屑只有一段；
4. **只读/网络档位的错误呈现**：把 `/api/files/list` mock 成 503，验证 UI 给出可重试的
   提示，而不是"目录不存在"。

> 将来跑法见 `AGENTS.md`：`cd e2e && node scripts/run-tests.mjs tests/0x-....spec.ts`，
> 只跑受影响的 spec；整套只在被要求时跑。

### 5.5 手工验证（无法自动化，必须做一次）

- **Windows**：`\\<某台机器>\<共享>`、`\\wsl.localhost\<发行版>` 能列目录、打开文件、
  预览图片、下载、重命名、删除；断网/共享离线时错误可读且可重试。
- **UNC 上的性能**：一个千文件目录的列表加载时间，对比 `local` 档位（验收"网络档位降并发"
  是否有效）。
- **属性窗口**：`utils.BirthTime` 在 UNC/WSL 上拿不到时应回落 mtime（现有 `ok=false` 路径）。
- **映射盘符**：在资源管理器里映射一个共享为 `Z:`，确认它出现在侧边栏且归类为 `network`。

## 6. 实现顺序与验收

| 阶段 | 内容 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| 1 | canonical 规则（前后端各一份）+ 表驱动测试 | 规则表全绿；**现有行为零变化** | ✅ 已实现 |
| 2 | 删 `safeBaseDir` / `IsPathSafe`，加 `startPath`，保留 `IsPathInsideOrEqual` | 全部既有 Go 测试绿；旧 config 仍能启动 | ✅ 已实现 |
| 3 | 挂载表 + `Resolve` + 调用点迁移 + 并发档位 + `getDrives` | 本地行为回归全绿；`getDrives` 带 `kind` | ✅ 已实现 |
| 4 | 前端（UNC 豁免、面包屑、`kind` 图标、起始状态） | 前端用例绿；地址栏/侧边栏交互符合 §5.3 | ✅ 已实现 |
| 5 | 文档 + CHANGELOG | `docs/config.md` 等无 `safeBaseDir` 残留；CHANGELOG 各一条 | ✅ 已实现 |
| — | E2E | 迁到 Windows 开发机后再做，用例见 §5.4 | 暂缓 |

阶段 3 实际落地的东西比计划多：迁移过程中发现并修掉了一批**只在 Windows 上暴露**的
缺陷（canonical 路径被 `filepath.Dir` 切错、盘符根退化成相对路径 `D:`、
UNC 会匹配到 `/` 这个挂载点、上传的 `keep-both` 返回错名字、properties WS 拿
canonical 路径直接喂 `os.Stat`）。这些单独记在 `CHANGELOG.md` 的 Fixes 里。

**没做**：§5.4 的 E2E 用例。AGENTS.md 要求在用户明确要求时才新增 / 运行 e2e，
本次改动虽然不小，但没有被要求，所以只跑既有 Go 与前端单测。

**建议**：阶段 1 与 2 可以合在一个 PR（前者零行为变更，后者是纯删除），
阶段 3 单独一个 PR（真正的重构），阶段 4 与 5 一起。这样每个 PR 的回归面都可控。

## 7. 最容易踩的坑（汇总）

1. **`path.Clean` 与 `filepath.Clean` 都不能用于 canonical 化**——一个吃 `//`，一个吃 scheme。
   用 `filepath` 做任何 VFS 路径运算都是 bug。
2. **`C:` 不是根**（相对路径），`C:/` 才是。任何"去尾斜杠"逻辑不能作用在根上。
3. **前端 `normalizePath` 的 `/\/+/g` 会吃掉 UNC 前缀**——这是现存 bug，不是新引入的。
4. **`filepath.Dir` 在非 Windows 上对 Windows 路径返回 `"."`**——父目录一律用 `path.Dir`。
5. **`filepath.IsAbs` 在非 Windows 上对 `\\server\share` 返回 false**——不要用它判 canonical 合法性。
6. **盘符大小写/Unicode 只做比较键**，真值原样保留；否则在大小写敏感平台上会指错文件。
7. **网络档位不能沿用 64 并发**，否则一个千文件目录会变成几千次网络往返。
8. **"服务器不可达"不能报成 404**，否则用户以为文件没了。
9. **删除 `IsPathSafe` 后，Zip Slip 校验必须写进将来 ZIP 后端/解压命令内部**，
   不能依赖路由层（本次不做 ZIP，但要在设计文档里留话）。
10. **`IsPathInsideOrEqual` 是词法判断**——原以为"符号链接可绕过"其实是错的（见阶段 2 更正）。
    唯一真实例外是不区分大小写的文件系统，由 `os.Rename` 兜底。
11. ~~e2e 夹具依赖 `safeBaseDir`~~ 已处理：夹具改用 `startPath`，盘列表在测试侧接管。
12. **canonical 路径在 Windows 上要小心 `filepath` 的每一种"看起来能用"的函数**。
    实测（Windows 上）：`filepath.Dir("D:/folder")` = `D:\`、`filepath.Base("D:/folder")`
    = `folder`——这两个能用；但**拼接**出来的中间结果不行：自己写字符串切片时
    `"D:/folder"` 的父目录会得到 `D:`，而 `D:` 是**驱动器相对路径**，
    `os.Stat("D:")` 会成功（指到进程当前目录所在的 D 盘目录），于是错误是静默的。
    判「是不是根」也一样：只比较 `splitRoot` 拼出来的根会让盘符下的**任何**路径
    都被判成根（`ComparisonKey("D:/a.txt") == ComparisonKey("D:") == "D"`），
    必须同时要求「根之后什么都没有」。
13. **UNC 不属于 `/` 这个挂载点**。`//server/share` 字面上以 `/` 开头，裸前缀匹配
    会让它命中 `/`，于是网络位置被判成本机卷（并发 64、图标错、错误码错）。
    Go 与前端两份 `isWithinRoot` 都要显式排除这一条。
14. **上传的 multipart 文件名要自带 `Base`**。老浏览器会发完整路径，
    Windows 上带 `\`；`filepath.Base` 只认本机分隔符，于是同一个上传在 Windows 上
    成功、在 Linux 上 400。分离器统一用 `fileops.BaseName`（两种都认）。
