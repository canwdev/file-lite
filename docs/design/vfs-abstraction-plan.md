# VFS 抽象层实现计划与测试清单

> 状态：**阶段 1 已实现**（canonical 规则，纯新增、零行为变更）；阶段 2-5 待实现。
>
> **E2E 暂缓**：开发机是 Linux，UNC/WSL 无法完整验证，等迁到 Windows 开发机再做。
> 本次改动不涉及 `e2e/`，但 §3.4 的夹具问题必须在**阶段 2 之前**定下来。
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

- [ ] `config.go`：删字段、全局变量、`SafeBaseDir()`、默认值 `"./"`、`:194-211` 整段
      （含"按需 MkdirAll 受限根"的逻辑）。
- [ ] `fileops/path.go`：删 `IsPathSafe`；`Clean` 改为调用 `canonicalizePath`；
      `samePath` 改为 canonical 比较 + 后端 `CaseSensitive` 判断（不要只比字符串）。
- [ ] 删除 9 个调用点：`routes/files.go:55`、`tasks/manager.go:183,197`、
      `fileops/scan.go:40`、`fileops/ops.go:111,129`。
- [ ] **保留** `utils.IsPathInsideOrEqual`（`utils/fs.go:20`）及其两个调用点
      （`routes/files.go:265`、`tasks/manager.go:205`），但修两个隐藏缺陷：
      解析符号链接后再比较、同挂载内才做 Rel。
- [ ] 启动输出（`main.go:202-237`）增加一行「文件访问范围: 全盘」。
- [ ] `docs/config.md` 删除该字段并说明变更（旧配置里的该字段会被忽略）。

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
| 2 | 删 `safeBaseDir` / `IsPathSafe`，保留 `IsPathInsideOrEqual` | 全部既有 Go 测试绿；旧 config 仍能启动 | 待实现 |
| 3 | 挂载表 + `Resolve` + 调用点迁移 + 并发档位 + `getDrives` | 本地行为回归全绿；`getDrives` 带 `kind` | 待实现 |
| 4 | 前端（UNC 豁免、面包屑、`kind` 图标、起始状态） | 前端用例绿；地址栏/侧边栏交互符合 §5.3 | 待实现 |
| 5 | 文档 + CHANGELOG | `docs/config.md` 等无 `safeBaseDir` 残留；CHANGELOG 各一条 | 待实现 |
| — | E2E | 迁到 Windows 开发机后再做，用例见 §5.4 | 暂缓 |

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
10. **`IsPathInsideOrEqual` 现在没解析符号链接**，软链接可绕过"移进自己的子目录"检查——
    本次要顺手修掉。
11. **e2e 夹具依赖 `safeBaseDir`**，阶段 2 之前必须先定 §3.4 的处置方式。
