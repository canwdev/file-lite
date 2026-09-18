# VFS 抽象层设计（本地 / UNC・WSL / 挂载点）

> 状态：**待实现**。本文是设计依据，落地步骤与测试清单见
> [`vfs-abstraction-plan.md`](./vfs-abstraction-plan.md)。
>
> 一句话范围：把「路径 = 本地绝对路径」这一隐含假设，换成「路径 = canonical VFS 路径 +
> 挂载表」，并让本地后端同时覆盖 UNC / WSL / 系统挂载点。

## 1. 背景与目标

当前后端把路径当**不透明字符串**直接交给 `os.*`（`routes/files.go:144` 的
`c.QueryParam("path")` → `os.Stat`），中间只有 `filepath.*` 的纯字符串运算。
这意味着它天然支持 UNC（`\\server\share`）与 WSL（`\\wsl.localhost\Debian`）——
它们本来就是本地路径——但也意味着它**没有任何能力声明、没有挂载点概念、
并且用 `filepath` 做路径运算会在非 Windows 平台损坏 UNC**。

目标：

1. 路径有**唯一 canonical 形式**，前后端一致，不依赖平台分隔符；
2. 引入**挂载表**（挂载点 = 可导航的根），作为导航边界与路径解析依据；
3. 本地后端同时覆盖三种形态，并允许**按挂载点区分运行时特征**（并发、超时）；
4. 为后续后端（ZIP 只读）留出确定的位置，但本次不实现。

## 2. 已确认的决策

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | `IsPathSafe` 与 `safeBaseDir` | **整体删除**（函数 + 配置字段 + 全局变量 + 前后端文档/夹具引用） |
| 2 | 保留的路径约束 | 只保留「目标不得位于源目录内部」（`utils.IsPathInsideOrEqual`，与受限根无关），以及将来的 Zip Slip 校验 |
| 3 | 本次支持的形态 | 本地盘卷、UNC、WSL、Linux/macOS 系统挂载点、Home |
| 4 | 本次不做 | ZIP 只读 VFS、解压/压缩命令、跨后端复制/移动、云后端、rclone |
| 5 | 路径表示 | **不带 scheme**：`C:/Users/me`、`//server/share/docs`、`/home/me`。`local://`、`net://`、`zip://` 一律作废 |
| 6 | 地址栏 | **永远正斜杠**，不显示反斜杠形态；不设独立的「显示层」 |
| 7 | 虚拟根节点（「此电脑」） | **不做**。没有虚拟根实体；未进入任何位置 = 显示挂载点列表 |
| 8 | 盘符/主机名/Unicode 大小写 | canonical **原样保留**；规范化只用于**比较键**，绝不改动路径本身 |
| 9 | `path.Clean` / `filepath.Clean` | 都不用于 canonical 化（前者吃 UNC 前缀与根尾斜杠，后者吃 scheme）。用 §3.3 的专用 cleaner |
| 10 | 符号链接 | canonical **不解析**；是否跟随由后端的 `Stat`/`Open` 决定 |
| 11 | ZIP 的将来形态 | 纯路径前缀：`D:/Downloads/temp.zip/temp/videos`（`.zip` 只是普通路径段，由挂载表赋予语义） |
| 12 | 侧边栏形态 | 单级列表（可分组），不做二级树；挂载点列表的语义是「根的前缀集合」 |

## 3. 实体模型

### 3.1 只有两个实体

| 实体 | 含义 | 说明 |
| --- | --- | --- |
| **canonical 路径** | 唯一真值，字符串 | 全链路 `/` 分隔，见 §4 |
| **挂载点** | 一个可导航的根 | 有显示名、类别、可选容量；是路径解析的边界 |

**没有第三个实体**。原来的「此电脑」是一个虚拟根节点，已确认不做：
未选中任何位置就是合法的 UI 状态（列表区显示挂载点列表）。

### 3.2 挂载表的两个用途

同一份挂载列表承担两件事，**不要拆成两套数据**：

1. **UI**：侧边栏的盘符/位置列表（`FileSidebar`），数据源仍是 `GET /api/files/drives`；
2. **解析**：判定一条路径属于哪个根、以及「返回上一级」的停点。

前端据此可以做**乐观显示**（面包屑、`canGoUp`），但**权威解析在后端**（§5.4）。

### 3.3 挂载点类别

| kind | 例子 | 容量 | 进侧边栏 |
| --- | --- | --- | --- |
| `volume` | `C:/`、`D:/` | 有 | ✅ |
| `network` | `//DESKTOP-ROGZ16/shared`、映射盘符 `Z:/` | 通常无 | ✅ |
| `home` | `C:/Users/me` | 有 | ✅（现有行为：列表第一项） |

将来的 ZIP 挂载点**不进侧边栏**——它在某个根之下，是路径前缀而不是出发位置。
这与决策 7、11 是同一件事的两面。

### 3.4 契约

后端复用现有 `types.Drive`，只加一个类别字段（前端 `types/server.ts:14` 同步）：

```go
// backend-go/types/types.go
type Drive struct {
    Label string `json:"label"`
    Path  string `json:"path"`   // canonical，无尾斜杠：`C:`、`//server/share`
    Kind  string `json:"kind"`   // volume | network | home
    Free  *int64 `json:"free,omitempty"`
    Total *int64 `json:"total,omitempty"`
}
```

约定：

- `Path` 用 **canonical 无尾斜杠**形式（`C:`、`//server/share`）。前端 `normalizeListingPath`
  自己补尾斜杠，不依赖后端；
- `Free`/`Total` 允许为 `nil`（网络位置拿不到容量）。**不要为了拿容量去逐个 ping 共享**，
  那会让侧边栏加载变慢甚至卡住；
- `Keep`：Windows 映射盘符由 `GetLogicalDriveStringsW` 枚举得到（`utils/drives_windows.go:22`），
  其 `GetDriveType` 为 `DRIVE_REMOTE` 时归类为 `network`；
- UNC / WSL / 系统挂载点的自动发现是**平台相关且不完整**的（见 §8.4），
  允许用户直接输入路径导航，不要求它们一定出现在列表里。

## 4. canonical 路径规则

### 4.1 总则

**VFS 路径只做字符串语义，不做文件系统语义。** 全链路只用 `/`；内部只用 `path`
（纯字符串）与 `strings`，**绝不用 `filepath` 的 `Join`/`Clean`/`Dir`/`Abs`/`Rel`**；
只在最后交给 `os.*` 之前用 `filepath.FromSlash` 转成本地分隔符。

标准库为什么都不能直接用（实测）：

```
filepath.Clean("zip:///data/a.zip/x") = "zip:/data/a.zip/x"   ← 吃掉 scheme
path.Clean("//server/share/docs")     = "/server/share/docs"  ← 吃掉 UNC 前缀
path.Clean("C:/")                     = "C:"                  ← 根丢了（C: 是相对路径）
filepath.Clean("//server/share")      = "/server/share"       ← 在 Linux 上塌掉
```

### 4.2 规则表

| # | 输入 | canonical | 规则 |
| --- | --- | --- | --- |
| 1 | `C:\Users\me\a.txt` | `C:/Users/me/a.txt` | `\`→`/`，折叠重复分隔符 |
| 2 | `C:\` 或 `C:` | `C:/` | 裸盘符 = 卷根；根保留尾斜杠 |
| 3 | `C:/Users/` | `C:/Users` | 非根去掉尾斜杠 |
| 4 | `\\server\share` | `//server/share/` | UNC 前导 `//` 保留；共享根保留尾斜杠 |
| 5 | `\\server\share\docs\` | `//server/share/docs` | 同上 |
| 6 | `\\wsl.localhost\Debian\home\me` | `//wsl.localhost/Debian/home/me` | WSL 是 UNC 特例，无额外规则 || 7 | `/home/me/../other` | `/home/other` | 允许在挂载根内折叠 `.` / `..` |
| 8 | `/data/../../etc` | **拒绝** | 折叠后越出挂载根 |
| 9 | `//server/share/../..` | **拒绝** | 不得逃出共享根 |
| 10 | `//server//share//docs` | `//server/share/docs` | 折叠重复分隔符 |
| 11 | `D:/Downloads/temp.zip/temp/videos/` | `D:/Downloads/temp.zip/temp/videos` | `.zip` 只是普通路径段 |
| 12 | `c:/Users` | `c:/Users` | **原样**；比较键才做大小写规范化 |
| 13 | `./foo`、`foo`、空串 | **拒绝** | API 只接受绝对路径 |
| 14 | `/data/a+b#c?.txt` | 原样 | 百分号解码**一次**后不再转义 |
| 15 | `/data/a\b.txt`（Unix） | `/data/a/b.txt` | `\` 一律折叠为分隔符（见 §8.2 的取舍：含反斜杠的 Unix 文件名因此不可达） |
| 16 | `/data/é.txt`（NFC/NFD） | 原样 | 不做 Unicode 归一化 |
| 17 | `C:Users` | **拒绝** | 驱动器相对路径（依赖进程当前目录），不猜成 `C:/Users` |
| 18 | `\\server`、`\\wsl.localhost\` | **拒绝**（`ErrPathNeedsShare`） | 只给到主机名；提示写成 `//host/share`。理由见 §8.4.1——`\\host\` 没有可用的 os 级实现 |

### 4.3 专用 cleaner

`path.Clean` 会破坏 UNC 与根，用「伪装根」绕开它：

```go
// canonicalizePath 归一化 wire 路径：只折叠重复分隔符与 . / ..，
// 保留 UNC 前导 //、保留根尾斜杠；绝不改动大小写、Unicode 或解析符号链接。
func canonicalizePath(p string) string {
	root := "/"
	switch {
	case strings.HasPrefix(p, "//"): // UNC：//host/share 作为前缀
		rest := strings.SplitN(strings.TrimPrefix(p, "//"), "/", 3)
		if len(rest) < 2 {
			return p // 不完整的 UNC 原样返回，由调用方判错
		}
		root = "//" + rest[0] + "/" + rest[1] + "/"
		p = "/"
		if len(rest) == 3 {
			p += rest[2]
		}
	case len(p) >= 2 && p[1] == ':': // 盘符
		root = p[:2] + "/"
		p = p[2:]
	}
	cleaned := path.Clean("/\x00" + p) // 伪装根，避免 Clean 吃掉前导 //
	out := root + strings.TrimPrefix(cleaned, "/\x00")
	if strings.HasSuffix(out, "/") && out != root {
		out = strings.TrimSuffix(out, "/")
	}
	return out
}
```

要点：

- **前缀先剥离、只清剩余部分、再拼回**；
- 盘符根的尾斜杠由 `root` 保证（`path.Clean("C:")` 返回的是**相对路径** `C:`，绝不能出现）；
- `\`→`/` 的转换只对**用户输入**做（§4.5），不对已 canonical 的值重复做。

### 4.4 比较键（不是路径）

为了让「`C:` 与 `c:` 是同一个卷」「`\\SERVER\share` 与 `\\server\share` 是同一个位置」
成立，另存一个**仅用于匹配**的键：

| 项 | 键规则 |
| --- | --- |
| 盘符 | 大写：`c:` → `C:` |
| UNC 主机名 | 小写；**共享名保持原样**（不同 SMB 服务器行为不一致，按敏感处理更安全） |
| 路径其余部分 | 大小写由后端 Caps 决定（Windows 不敏感、Linux 敏感），**不能靠字符串比大小写** |

**键永不当作路径使用。** 返回给 OS、显示给用户、写回前端的一律是原样大小写。

### 4.5 HTTP 边界

- 路径在 URL 中 `encodeURIComponent` **一次**，框架解码**一次**；解码后的字符串就是 VFS 路径，
  内部不再有任何 encode/decode（`+` 是字面加号，不是空格——CHANGELOG 记录过这个 bug）；
- `\`→`/` 的归一化在**前后端都做**：前端保证用户粘贴 `C:\Users` 能被识别，
  后端保证从任何来源（含直接调 API 的脚本）进来的反斜杠都被同样处理。
  两处都必须**豁免 UNC 前导 `//` 不被折叠**；
- `filepath.FromSlash` 只在 `os.*` 调用前使用一次。

## 5. 后端结构

### 5.1 后端接口

本次只有一种实现（local），但接口先立起来，让 ZIP 有确定的位置：

```go
type Caps struct {
	ReadOnly       bool
	CaseSensitive  bool
	HardLinkCount  bool // 拿不到时 isLink 只依据 symlink
	Birthtime      bool
	AtomicPublish  bool // 目标同目录临时文件 + rename
}

type Backend interface {
	Stat(ctx context.Context, p string) (types.Entry, error)
	ReadDir(ctx context.Context, p string) ([]types.Entry, error)
	Open(ctx context.Context, p string) (io.ReadSeekCloser, error) // 缩略图需要 Seek
	Caps() Caps
}
```

- 只有 local 实现可写方法（Mkdir/Remove/Rename/Write），只读后端不实现；
- `Caps` 用于三件事：错误码/降级、并发档位（§5.3）、前端能力上报。

### 5.2 解析器（取代 `IsPathSafe` 的 9 个调用点）

`IsPathSafe` 现在的调用点：`routes/files.go:55`、`tasks/manager.go:183,197`、
`fileops/scan.go:40`、`fileops/ops.go:111,129`（含定义处共 9 处）。
它们**不是删掉了事**，而是收敛成一个入口：

```go
// Resolve 把 canonical VFS 路径解析为「挂载点 + 交给 OS 的本地路径」。
// 它是所有文件操作的强制入口：调用方不再自己判安全、不再自己拼 OS 路径。
func Resolve(p string) (mount Mount, osPath string, err error)
```

- 匹配规则：**最长前缀 + 段边界**（`/data2` 不得匹配挂载点 `/data`）；
- 未匹配到任何挂载点时：若是绝对路径仍可解析（local 后端覆盖整个文件系统），
  但要为该路径派生一个 `kind=network` 的临时档位判断（§5.3），
  而不是直接放行到"无特征"状态；
- 「目标不得位于源目录内部」的检查**保留**（`utils/fs.go:20`），
  并顺带修掉两个现存的隐藏假设：纯字符串比较（应解析后比较）、**未解析符号链接**
  （软链接指向祖先目录可绕过）。见 `routes/files.go:265`、`tasks/manager.go:205`。

### 5.3 运行时档位（本次唯一新增的“后端差异”）

UNC / WSL / 系统挂载点看起来是本地路径，行为不是。当前 `readDirStatConcurrency = 64`
（`routes/files.go:23`）配两段式（`ReadDir` 后每项一次 `os.Stat`，`:187-207`）
在 SMB 上就是 **N+1 次网络往返 × 64 并发**。

| 档位 | 并发 | 适用 |
| --- | --- | --- |
| `local` | 64（现状） | `C:`、`/`、Home |
| `network` | 4–8 | UNC、WSL、系统挂载点 |

判定来源：挂载点 `kind`；未匹配到挂载点时按「UNC 形态」或「路径不在本机已知卷上」判断。
错误映射同样按档位区分：网络档位的「服务器不可达/超时」应映射为 502/503
（前端可显示重试），**不要与「文件不存在」（404）混为一谈**。

### 5.4 前端信任边界

前端可用挂载点做**乐观显示**（面包屑、`canGoUp`），但：

- 不自己实现第二套 canonical 规则；
- 路径合法性、属于哪个挂载点，**一律以后端返回为准**。

## 6. 前端结构

### 6.1 起始状态与导航边界

- 启动时**不再默认 `/`**（现在是 `use-navigation.ts:37-38` 与 `utils/navigation-history.ts:25`
  的 `'/'`），而是「未选中任何位置」→ 列表区显示挂载点列表（复用现有
  `driveList` + `openFirstDrive()`，`FileManager.vue:123,131`）；
- **面包屑第一段 = 挂载点根**，不是虚拟节点：
  `D:/ > Downloads > temp.zip > temp`、`//server/share/ > docs`、`/ > home > me`；
- `canGoUp` 的停点：当前路径是否**严格长于**其最长匹配挂载点。
  `D:/` 不能再上；`//server/share/` 不能上到 `//server/`。

### 6.2 现有前端的落点

| 文件 | 现状 | 改动 |
| --- | --- | --- |
| `FileManager/utils/index.ts:1` | `normalizePath` 用 `/\/+/g` 折叠**所有**重复斜杠 | **豁免 UNC 前导 `//`**（当前唯一会破坏数据的函数） |
| 同上 `:18` `canGoUp`、`:25` `getParentPath` | `startsWith('/')` 二分法（Unix vs Windows 相对路径） | 改为挂载点驱动 |
| `ExplorerUI/AddressBar.vue:26-59` | 根硬编码为 `/`；非 Unix 分支第一段没有根 | 第一段 = 挂载点根 |
| `ExplorerUI/drives.ts:56` | `resolveVolumeRoot` 最长前缀（`startsWith`，无段边界） | 加段边界检查，防止 `/data2` 匹配 `/data` |
| `ExplorerUI/drives.ts:19` | 盘符统一 `normalizeListingPath` | 保留；`IDrive.kind` 加入类型 |
| `ExplorerUI/FileSidebar.vue:39` `getIcon` | `if (!item.total)` 判文件夹图标 | **改看 `kind`**：网络位置无容量，否则会全变文件夹图标 |
| `types/server.ts:14` `IDrive` | `{label,path,free,total}` | 加 `kind` |

新图标名（网络位置、WSL）必须按 `AGENTS.md` 注册进 `mdiIconRegistry`（`utils/icons.ts`），
否则静默回落成问号图标。

## 7. 明确不做的事（避免范围蔓延）

| 不做 | 原因 / 将来位置 |
| --- | --- |
| scheme 前缀（`local://`、`net://`、`zip://`） | 会被标准库 clean 吃掉，且发明第二套用户不必学的地址（决策 5） |
| 独立「显示层」/ 反斜杠地址栏 | 决策 6；需要 `\` 形态时由后端 `filepath.FromSlash` 生成 |
| 虚拟根「此电脑」 | 没有意义勿增实体（决策 7） |
| ZIP 只读 VFS | 独立立项：归档内索引层（中央目录 → 虚拟目录树、目录条目可能不存在、size/mtime 从 `FileHeader` 合成、symlink 外部属性位）是主要工作量 |
| 解压 / 压缩命令 | 压缩包成员名必须逐条做 Zip Slip 校验；不要依赖已删除的 `IsPathSafe` |
| 跨后端复制 / 移动 | 本次只有 local 实现，跨挂载但同为 local 的复制/移动保持现有行为（走 `isCrossDeviceError` 回退） |
| 云后端 / rclone | 需重新引入凭据管理，已明确不做 |

## 8. 已知风险与开放问题

### 8.1 全盘可访问（语义变更，必须显式告知）
删除 `safeBaseDir` 后默认即全盘可读写。建议在启动输出（`main.go:202-237`）打印
「文件访问范围: 全盘」，并在 `docs/config.md` 写清。这是告知，不是兜底。

### 8.2 反斜杠文件名的取舍
`\` 在 Unix 上是合法文件名字符。前端在所有平台做 `\`→`/` 归一化，
等于此类文件**在 Web UI 中不可达**。取舍：接受不可达（成本为零、体验与 Windows 一致），
**但后端绝不可对 Unix 路径自作主张做 `\`→`/`**——那会静默指向另一个文件。

### 8.3 Zip Slip 是将来唯一还需要 containment 的地方
`IsPathSafe` 删除后，压缩包成员名不得为绝对路径、不得含 `..`、不得越出目标根，
这一校验必须在 **ZIP 后端/解压命令内部**实现，不能依赖路由层。

### 8.4 网络位置的自动发现是平台相关且不完整的
Windows「网络邻居」的自动枚举走 COM 外壳命名空间（`IShellFolder`），
重且与「不管凭据」冲突。本设计只要求：枚举本机卷 + 映射盘符
（`GetDriveType == DRIVE_REMOTE`）、Unix 下从 `/proc/mounts` 识别 cifs/nfs/9p，
其余靠用户直接输入路径。**不承诺**完整的网络发现。

#### 8.4.1 `\\host\` 本身不支持，且拒绝是有技术依据的

只写到主机名的 UNC（`\\wsl.localhost`、`\\DESKTOP-ROGZ16`）被拒绝，返回
`ErrPathNeedsShare`（`//host/share` 才接受）。这不是「懒得做」，而是它**没有可用的
os 级实现**：

- Win32 文件 API 不接受 UNC 主机根。实测
  `[System.IO.Directory]::GetDirectories('\\wsl.localhost')` 与
  `'\\DESKTOP-ROGZ16'` 一律 `ERROR_INVALID_NAME`（"The specified path is invalid"），
  加不加尾斜杠都一样。
- 资源管理器里之所以能展开，是因为它走**外壳命名空间**（`IShellFolder` /
  网络邻居）自己枚举共享，而不是把 `\\host\` 当成目录去读。
- 本项目的每一层都建立在「路径交给 `os.*` 就能用」之上（见 §4、§5），
  引入一条「只有外壳能解析的路径形态」会让 canonical 规则、挂载表、并发档位、
  错误映射同时失去依据。
- 枚举共享还要网络往返与凭据处理，与 §8.4 的「不管凭据」直接冲突。

**因此**：`\\host\share` 与 `\\wsl.localhost\<发行版>` 完全支持（共享名就是根），
`\\host\` 报错并提示正确写法。侧边栏也不列网络位置——用地址栏输入即可。

#### 8.4.2 WSL 发行版例外：列进侧边栏

`\\wsl.localhost\<发行版>` 属于「用户不知道它存在」的那一类——地址栏能用，但没人会
凭空知道这条命名规则。因此**WSL 发行版进侧边栏**，实现是 `utils/drives_windows.go`
的 `wslDistroDrives()`：

- **只读注册表** `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss\*` 的
  `DistributionName`（实测约 1ms），**不调 `wsl.exe -l`**——子进程会拉起 WSL 服务、
  有可见延迟，而侧边栏加载不该等它；
- 每个发行版产出 `//wsl.localhost/<发行版>`，`kind = network`：9p 共享要走网络栈，
  所以并发档位 6、错误映射 503、网络图标全部自动正确（与 `GetUnixMounts` 把 9p 标成
  network 同源）；
- 路径不可达时不预先探测：点进去会得到一个可读的错误，这比枚举时联网探测更诚实；
- 排序：盘符在前、网络位置在后。不能只按 Path 排——`//` 的 `/` (0x2F) 排在 `C` (0x43)
  之前，会把 WSL 挤到本地盘上面。

**这不是 §8.4 排除的那件事**：§8.4 排除的是「网络邻居枚举」（COM 外壳命名空间、
依赖 Computer Browser / WS-Discovery、可能需要几十秒），WSL 是本机注册表、
离线、毫秒级。两者只是都产出 UNC 路径而已。

真正的网络共享（`\\DESKTOP-ROGZ16\shared`）仍然靠地址栏输入。若要让它也可以固定，
正确的形态是用户可维护的 `networkLocations: string[]`（写进 config，侧边栏单开
Network 分组），而不是自动枚举。

### 8.5 `filepath.Dir` 的跨平台陷阱
`filepath.Dir("C:\\Users\\me\\a.txt")` 在非 Windows 上返回 `"."`。
`routes/fs_changes.go:58,67,74` 与 `routes/files.go:416` 依赖它取父目录——
统一改用 canonical (`path.Dir`) 之后取父目录，只在最后一刻转 OS 路径。

### 8.6 符号链接穿越挂载根
`\\wsl.localhost\Debian` 或 SMB 共享内部的符号链接可能指向挂载根之外。
local 后端现有的「链接只删链接本身」语义（`fileops/ops.go:164-182`）必须保留；
只读/网络档位建议默认不跟随链接，并在能力声明里说明。
