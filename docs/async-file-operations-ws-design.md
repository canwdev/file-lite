# 文件操作异步化 + WebSocket 通信 + 可取消

> 状态：**已实现**。本文既是最初的设计依据，也是现在的实现说明——
> §0.1 是实现状态与测试覆盖，§0.3 记录了后来删掉崩溃残留清理（journal）的取舍。
> 冲突策略（overwrite / skip / keep-both、Windows 式目录合并）在本文 §4，没有单独的冲突文档。
> 关联：多面板 / 多标签页 / 多选拖拽方案**已搁置**，见 `docs/todo/frontend-multi-panel-design.md`。

## 0. 已确认的决策

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 上传/下载的字节流 | **保持 HTTP**（浏览器原生流式写盘 + `Content-Length` 进度 + 中断），只把任务行并入统一任务面板 |
| 2 | `scanning` 预扫描的开销 | **可接受**，用它换精确总进度、零副作用冲突预判和目录合并的完整冲突清单 |
| 3 | 取消时的清理 | **不做 rollback**（不回收已完成的成果），但**必须保证文件完整性：磁盘上不允许出现半个文件** |
| 4 | 任务可见范围 | **所有已连接客户端可见、可取消**（广播模型） |
| 5 | UI 交互 | **模仿 Windows 资源管理器**（冲突对话框、进度窗口、错误对话框、拖拽语义） |

### 0.1 实现状态（截至本次落地）

已实现：

- **后端 `fileops` 包**：ctx 感知的复制 / 移动 / 删除；「同目录临时文件 + 原子改名」发布；`.fl-part-` 前缀对列表 / 创建 / 重命名 / 上传 / **zip 打包**全部屏蔽；预扫描（条目 / 字节 / 冲突）与 Windows 式目录合并语义；结果集有内存上限（失败 / 冲突单独限额，见 0.3）。
- **后端 `tasks` 包**：任务状态机（queued / scanning / awaiting-conflict / running / 终态）、全局并发闸门、单任务文件并发、200ms 节流广播、取消、冲突 TTL、完成任务保留与 `PendingConflicts` 补齐。
- **WebSocket**：`tasks` 与 `fs` 两个 scope；每客户端出站队列（进度可丢、终态不可丢）+ 写超时 + ping/pong 心跳；连上即全量快照 + 未决冲突补发。
- **前端**：任务 store（快照 / patch / done / 冲突队列、重连对账）、`api/tasks-ws.ts`、element 冲突弹窗（Replace / Skip / Keep both + 逐项或「应用于全部」+ 前后信息对照）、复制 / 移动 / 删除 / 复制副本全部切到任务模型、`fs changed` 驱动目录刷新（取代 `moveRefresh`）、右下角常驻的 `Transfers / Tasks` 双页签面板（见 §5.2）。
- **配置**：`taskConcurrency` / `copyFileConcurrency` / `copyFsync`（缺省 fsync 开启）。
- **失败清单与重试**：任务结束时若存在失败 / 冲突项，本窗口会弹出 `N items failed` 清单（可滚动、带原因，超出 200 条时提示只展示前 200 条）；`retry` 命令由**服务端从内部完整结果**里取失败路径重建任务，因此不受 done 事件截断影响，重试的是全部失败项。任务行上也有入口可重新打开清单。
- **上传同名冲突**：`upload-file` 新增 `onConflict`（`error` 缺省 / `overwrite` / `keep-both`），并新增 `POST /files/exists` 做上传前批量预检；上传改为复用 `fileops.PublishFile`，因此中断的上传也不会留下半个文件。前端在入队前预检并复用同一个冲突弹窗。
- **进度面板生命周期**：新的客户端传输出现时自动弹出并切到 `Transfers` 页签，新的服务端任务出现时自动弹出并切到 `Tasks` 页签，全部到终态后自动收起；状态栏保留入口按钮显示 / 隐藏面板（正在跑 / 有失败时带角标）；隐藏不取消任何在跑的任务；失败时另有自动弹出的失败清单。
- **测试**：
  - 后端：`fileops` 单测（策略矩阵、取消后无残留、结果集上限、扫描、完整性不变式）+ `tasks` 单测（冲突暂停 / 决策 / 取消 / TTL / 重试 / created 广播）+ `routes` 上传单测（默认拒绝 / overwrite / keep-both / 保留前缀 / exists）+ 启动死锁回归，均通过 `-race`。
  - 前端：独立 Playwright 子项目 `e2e/`，17 个用例约 50 秒，覆盖冲突弹窗、上传冲突、进度条、运行中取消、失败清单与重试、跨窗口可见性；截图与测试方法见 `docs/frontend-ui-testing.md`。
  - 另有真实 WS 手工冒烟（冲突→决策→执行、运行中取消、中断上传、临时文件不可见）。

### 0.3 后来的取舍：删掉了崩溃残留清理（journal）

最初实现过一个「临时文件账本」：每写一个临时文件就登记到 `active-file-ops.json`，
进程被强杀 / 断电后下次启动按账本删掉残留。**后来把它删了**，理由是实测的成本收益：

| 2000 个小文件（4KB，逐文件 fsync） | 耗时 |
| --- | --- |
| 带 journal | 206 ms |
| 不带 journal | 88~101 ms |

也就是说每复制一个文件要多花约一倍的时间，而换来的只是「崩溃后帮你删掉一个
用户看不见的临时文件」。而且它引入了一处全局可变状态（账本 + 锁），
实现期间真的因此踩出过一次服务端启动死锁。

现在保留的是**原子发布**本身——它才是「磁盘上不出现半个文件」的保证，与账本无关。
崩溃后可能留下一个孤儿 `.fl-part-*` 文件，它被列表接口和 zip 打包双双过滤，
用户接触不到，代价只是占磁盘。

### 0.2 UI 测试抓到的缺陷（已修）

浏览器端到端测试暴露了三个只在真实前端才会出现的 bug，后端单测与 WS 冒烟都测不到：

1. **新任务永远不会出现在界面上**：客户端没有处理任务的创建事件，而后继的 `update` / `done`
   在「查无此任务」时被直接丢掉。修复：新增 `created` 广播（带完整快照）。
2. **打开应用看不到进行中的任务**：初始快照只在 WS 状态*变化*时拉取，而设置模块通常先连上 WS，
   此时状态已经是 `connected`，watch 不触发。修复：watch 加 `immediate: true`。
3. **任务窗口一直盖住文件列表**：浮动窗口结束后不关闭，拦截列表点击。修复：全部结束且无失败时自动收起 + 状态栏重开入口；§5.2 又把浮窗换成了不阻挡操作的右下角常驻面板。


未实现（与本文设计的偏差，按「不考虑多面板、只要进度条」的要求收敛）：

- **暂停 / 恢复**：未做（进度条已覆盖需求）。
- **`Compare info for both files`**：未做；弹窗里只展示两侧大小与修改时间，不提供逐项挑选。
- **资源管理器式独立进度窗口 / `More details`**：改为右下角常驻面板 + 每任务进度条（见 §5.2）；失败清单（`N items failed` + Try Again）已按资源管理器形态实现。
- **运行中再次撞到冲突的二次询问**：当前安全地记为 `conflict` 并跳过，任务以 `partial` 结束并给出计数，不会覆盖。
- **多面板 / 多标签页 / 多选拖拽**：全部不做。
- **任务 owner 校验**：按决策 4 维持「所有客户端可见可取消」。
- **持久化**：任务仍是内存态，进程重启即中断；崩溃残留的临时文件不再自动清理（见 0.3）。
- **外部目录变化监听（fsnotify）**：`fs changed` 目前只在任务终态触发。
- 保留 `POST /files/delete`：已不被前端使用（删除走任务），仅作为后端能力保留。

---

## 1. 目标

1. 复制/移动/删除/复制副本 → 服务端异步任务：提交即返回、后台执行、推送进度、可暂停、可取消。
2. WebSocket（复用现有 `/api/ws`）作为唯一的操作通道，新增 `tasks` 与 `fs` 两个 scope。
3. 冲突在异步模型里被正确解决：任务**先扫描、再暂停等待用户决策**，磁盘零副作用。
4. 目录变化主动通知前端刷新，取代现有 `moveRefresh` 补丁。
5. 交互形态对齐 Windows 资源管理器。

---

## 2. 现状盘点

### 2.1 已经具备的 WS 基建（直接复用）

`backend-go/routes/shared_ws.go`：

- 端点 `/api/ws`，鉴权支持 `?token=` / `Authorization` / cookie。
- **按 `scope` 分发**：`switch scope { case "text-sync": ...; case "settings": ... }`（:110-127），新增 scope 只需加 case。
- 每 IP 连接上限 20、Origin 校验、`sendSharedWSJSON` 带 `writeMu`。
- `settings` scope 已跑通「`requestId` 请求/响应 + 全客户端广播」范式（`shared_ws_settings.go`）。

前端 `api/shared-ws.ts` 已具备自动重连、pending 请求 + 超时、`subscribeSharedWsMessage` 订阅。新增 scope 是增量工作。

### 2.2 现有异步模型只在客户端

`frontend/src/utils/task-queue.ts` + `TransferQueue.vue` 已实现并发队列、逐项进度、`AbortController` 取消、失败重试、虚拟滚动、rAF 节流渲染。但只覆盖上传/下载，服务端没有任何任务概念。

### 2.3 操作分类（决定异步边界）

| 操作 | 现实现 | 改造后 | 理由 |
| --- | --- | --- | --- |
| copy / move / duplicate | HTTP 同步 | **异步任务** | 大目录可跑几分钟 |
| delete | HTTP 同步 | **异步任务** | 递归删除同理 |
| upload / download | HTTP + 客户端队列 | **保持 HTTP**，并入统一任务面板 | 见 §0 决策 1 |
| list / drives / thumbnail / stream | HTTP | 保持同步 | O(1) 或流式 |
| create-dir / rename | HTTP | 保持同步 | 瞬时元数据操作 |

---

## 3. 服务端设计

### 3.1 包结构

```
backend-go/
├── fileops/               新包：与传输无关、可取消的文件操作原语
│   ├── copy.go            Copy / Move（ctx 感知、进度回调、结果收集）
│   ├── delete.go          Remove（ctx 感知）
│   ├── conflict.go        冲突探测、Windows 合并语义、uniquePath
│   ├── scan.go            预扫描：条目数 / 字节数 / 冲突清单
│   ├── tempfile.go        临时文件命名（同目录、随机后缀）
│   └── path.go            isPathSafe / existsAt（从 routes 迁入）
├── tasks/                 新包：任务管理器（异步执行 + 状态机 + 事件）
│   ├── manager.go         注册表、并发闸门、订阅广播、取消、暂停
│   ├── task.go            任务结构、状态机、快照、结果聚合
│   └── emit.go            节流上报
└── routes/
    ├── tasks_ws.go        新：scope "tasks" 消息解析与分发
    ├── fs_ws.go           新：scope "fs" 目录变化广播
    ├── shared_ws.go       改：switch 增加两个 case
    └── files.go           改：删除 copyPastePath / deletePath；列表排除临时文件
```

### 3.2 任务模型

```go
type Kind string // "copy" | "move" | "delete" | "duplicate"

type State string
const (
    StateQueued           State = "queued"
    StateScanning         State = "scanning"
    StateAwaitingConflict State = "awaiting-conflict"
    StateRunning          State = "running"
    StatePaused           State = "paused"
    StateCancelling       State = "cancelling"
    StateSucceeded        State = "succeeded"
    StatePartial          State = "partial"    // 有失败项但整体跑完
    StateFailed           State = "failed"
    StateCancelled        State = "cancelled"
)

type Task struct {
    ID        string
    Kind      Kind
    FromPaths []string
    ToPath    string
    IsMove    bool

    OnConflict  string // "ask"(默认) | "overwrite" | "skip" | "keep-both"(可选)
    StopOnError bool

    State    State
    Progress Progress        // itemsTotal/Done, bytesTotal/Done, currentPath
    Results  []ItemResult
    Error    string
    CreatedAt, StartedAt, FinishedAt int64

    ctx     context.Context
    cancel  context.CancelFunc
    pauseMu sync.Mutex
    paused  bool
    resume  chan struct{}   // 暂停闸门，文件边界检查
    mu      sync.Mutex
}
```

`Progress` 由原子计数 + 节流上报维护，不放在高频锁里。

### 3.3 管理器

- **全局注册表** + 有序列表；完成任务保留最近 100 条 / 24h，之后清理。
- **并发闸门**：全局最多 2 个任务 `running`（其余 `queued`）；单任务内文件并行度默认 4。两者都进 `config.json`。
- **创建限额**：队列上限 32。
- **广播**：所有已鉴权客户端收到所有任务事件（决策 4）；任务带 `origin` 仅用于展示。
- **生命周期**：创建者断开不取消任务；`fs changed` 照常广播。

### 3.4 状态机

```
 create
   │
   ▼
 queued ──cancel──────────────────────────────────────┐
   │                                                  │
   ▼                                                  │
 scanning ──有冲突且策略=ask──▶ awaiting-conflict ──resolve──▶ running
   │  │                              ▲   │                      │
   │  └──无冲突──────────────────────┘   │ cancel               │ pause
   │                                    ▼                      ▼
   │                                cancelling              paused
   │                                    │                      │ resume
   │                                    ▼                      │
   │                                cancelled ◀────────────────┘
   └──▶ running ──▶ succeeded / partial / failed
                       ▲
          运行中撞到新冲突 ──▶ awaiting-conflict（再次询问）
```

- **`scanning` 是真正的预扫描**：walk 源路径统计条目/字节，并按 §4.2 的合并语义检测冲突。这一步之后**磁盘零改动**，所以冲突弹窗是零副作用的。
- **`awaiting-conflict` 是正常状态**：可以有多个任务同时停在这里，前端排队弹窗。
- **运行中再次撞到冲突**（预扫描后被别处创建）：切回 `awaiting-conflict` 并推送事件，绝不静默覆盖。
- **断线期间停在 `awaiting-conflict`**：TTL 10 分钟后置 `failed`（"conflict unresolved"），**绝不猜测策略**。

### 3.5 文件完整性保证（对应决策 3）

核心规则：**每个常规文件都通过「同目录临时文件 + 原子改名」发布，磁盘上永远不存在半个文件。**

```
复制一个文件：
  src/a.txt  →  dst/.fl-part-<taskid8>-<rand>   （写入 + 计数进度）
                    │  写完
                    ├─ chmod / chtimes 对齐源文件
                    ├─ fsync（默认开，可配置）
                    └─ os.Rename(tmp → dst/a.txt)   ← 原子发布
  取消/出错：删除 tmp，什么都不留下
```

- **临时文件必须与目标同目录**：保证 `os.Rename` 同文件系统、原子生效。
- **取消可以发生在任何时候**：写文件中途取消 → 删除 tmp → 已完成的其他文件保持完整。
- **覆盖文件不需要先删目标**：POSIX 与 Go 在 Windows 上的 `os.Rename` 都是替换语义（`MOVEFILE_REPLACE_EXISTING`），新内容原子顶替旧内容，中途不会出现"目标不存在"的窗口。
- **文件 ↔ 目录的类型冲突**（Replace 选中时）：`Rename` 无法顶替目录，必须 `removeEntrySafely(目标)` 再发布；这是唯一有短暂空窗的情况，弹窗文案需要说明。
- **目录本身不做原子发布**：目录直接创建、逐个文件填充，取消时可能留下一个"内容不完整但每个文件都完整"的目录——这符合决策 3 的边界（不允许半个文件，允许半个目录）。结果里如实报告已复制项数。
- **符号链接/硬链接**：沿用现有语义，只复制链接本身，不跟随、不递归。
- `duplicate` 与 `keep-both` 的自动改名走 `uniquePath`。

**崩溃残留（已改为不处理）**：进程被强杀 / 断电时可能留下孤儿临时文件。
早期版本用一个 journal 账本在启动时清理它，实测让每个文件的复制开销翻倍（见 0.3），
所以删掉了。现在依赖两件事让它无害：

- 列表接口与 zip 打包都按前缀过滤，用户看不见也拿不到；
- 临时文件名带随机后缀，后续复制不会与它撞名。

如果以后确实需要清理，便宜的做法是在任务 `scanning` 阶段顺手删掉「马上要写入的目录」里
同前缀的残留——不需要全局账本，也不需要每文件额外的系统调用。

**关于 fsync**：默认在改名之前 `fsync` 临时文件，使"改名即完整"在断电场景也成立；代价是大量小文件时更慢，用配置项 `copyFsync` 提供关闭开关。

### 3.6 取消与暂停

- `context.Context` 贯穿：`copyDir` 每个条目、`io.Copy` 每次 `Read`（`ctxReader` 包装）、递归删除每次迭代。
- **取消**：`cancelling` → 当前文件中断 → 删除 tmp → `cancelled`。不做 rollback（决策 3），已完成的部分保留并计入结果。
- **暂停**：闸门只在**文件边界**检查，当前文件一定写完并原子发布后才进入 `paused`。这是"暂停也不会产生半个文件"的原因，也是暂停响应有延迟（等待当前文件）的原因，UI 需要如实显示「正在暂停…」。
- `cancel` 幂等；对终态任务返回 `error`。
- 对 `move`：同分区 `Rename` 原子且瞬时，通常来不及取消；跨分区回退到复制+删除，可取消，取消后源文件保留。

### 3.7 WS 协议（新增 scope）

**客户端 → 服务端**

```jsonc
{ "scope": "tasks", "type": "create", "requestId": "req_1",
  "task": { "kind": "copy", "fromPaths": ["/data/a"], "toPath": "/data/target/",
            "onConflict": "ask", "stopOnError": false } }

{ "scope": "tasks", "type": "cancel",  "taskId": "t_1" }
{ "scope": "tasks", "type": "pause",   "taskId": "t_1" }
{ "scope": "tasks", "type": "resume",  "taskId": "t_1" }
{ "scope": "tasks", "type": "resolve", "taskId": "t_1",
  "policy": "overwrite", "applyToAll": true,
  "items": [{ "relativePath": "sub/a.txt", "policy": "skip" }] }   // items 非空则优先
{ "scope": "tasks", "type": "list",    "requestId": "req_2" }      // 重连后对账
{ "scope": "tasks", "type": "dismiss", "taskId": "t_1" }           // 移除已结束任务
```

**服务端 → 客户端**

```jsonc
{ "scope": "tasks", "type": "response", "requestId": "req_1", "taskId": "t_1" }
{ "scope": "tasks", "type": "snapshot", "tasks": [ /* TaskSnapshot */ ] }

{ "scope": "tasks", "type": "update", "taskId": "t_1",
  "patch": { "state": "running",
             "progress": { "itemsTotal": 120, "itemsDone": 37,
                           "bytesTotal": 812345678, "bytesDone": 229102233,
                           "currentPath": "/data/a/big.iso" } } }

{ "scope": "tasks", "type": "conflict", "taskId": "t_1",
  "destPath": "/data/target/", "isMove": false,
  "totalCount": 5, "truncated": false,
  "conflicts": [
    { "relativePath": "a.txt",        "kind": "file-vs-file",
      "sourceIsDirectory": false, "destIsDirectory": false,
      "sourceSize": 2411724, "destSize": 1180000,
      "sourceMtime": 1730000000000, "destMtime": 1729000000000 },
    { "relativePath": "docs/readme",  "kind": "file-vs-dir",  "sourceIsDirectory": false, "destIsDirectory": true }
  ] }

{ "scope": "tasks", "type": "done", "taskId": "t_1", "state": "partial",
  "results": [ { "fromPath": "...", "toPath": "...", "status": "copied" },
               { "fromPath": "...", "status": "failed", "message": "permission denied" } ] }

{ "scope": "tasks", "type": "error", "requestId": "req_1", "message": "..." }
```

`conflicts[].kind` 三档：`file-vs-file`（可 Replace / Skip / Compare）、`file-vs-dir`、`dir-vs-file`（可 Replace / Skip）。`dir-vs-dir` **不进冲突清单**——按 Windows 语义静默合并。

`totalCount` 与数组分离：只带前 200 条 + `truncated`，UI 显示「共 N 项，展示前 200」。

**目录变化（新增 `fs` scope）**

```jsonc
{ "scope": "fs", "type": "changed", "paths": ["/data/target/"] }
```

任务到达终态时广播；前端只要 `basePath` 命中就刷新。这一条取代 `use-copy-paste.ts:105-113` 的 `moveRefresh`。

### 3.8 传输层健壮性（异步化后必须补）

现在 `sendSharedWSJSON` 是「持锁同步写」，一个慢客户端会拖住整个广播。低频 settings 无所谓，高频任务进度下会变成故障。必须补：

1. **每客户端出站队列 + 单写协程**：广播只入队；队列满时合并/丢弃进度类 `update`，`done`/`conflict`/`error` 不可丢。
2. **心跳**：`SetReadDeadline` + ping/pong，及时释放死连接。
3. **写超时**：`SetWriteDeadline`，避免写协程永久卡住。
4. **消息体积**：冲突列表截断；`results` 超大时截断 + 汇总计数。

### 3.9 安全与限制

- 创建任务时对每个 `fromPaths` / `toPath` 做 `isPathSafe`（`config.SafeBaseDir()` 之内），保留「目标在源内部」检查（`utils.IsPathInsideOrEqual`）。
- 删除沿用 `removeEntrySafely` 的链接语义（只删链接本身）。
- 任务注册表纯内存；**进程重启会中断进行中任务**。UI 需要提示。

---

## 4. 冲突设计

### 4.1 探测时机

- **预扫描阶段收集完整冲突清单**（因为决策 2 接受扫描开销）：源树 walk 的同时，对将发生合并的目标目录也 walk 一遍，得到 `relativePath` 级别的冲突列表。
- 好处：弹窗在磁盘零改动时出现；「应用于全部」一次问清；总进度精确。
- 运行中若因竞态再次撞到冲突 → 回到 `awaiting-conflict` 再问一次。

### 4.2 Windows 资源管理器语义（取代旧文档的「目录整体替换」）

| 源 vs 目标 | 行为 |
| --- | --- |
| 目录 vs 目录 | **静默合并递归**，不询问；冲突在内部文件层再判定 |
| 文件 vs 文件 | 冲突 → Replace / Skip /（可选 Keep both）/ Compare info |
| 文件 vs 目录 | 冲突 → Replace（删除该目录后放入文件）/ Skip |
| 目录 vs 文件 | 冲突 → Replace（删除该文件后建目录）/ Skip |

这修正了早期方案里「overwrite 对目录是整体替换」的结论——因为要模仿资源管理器，目录必须合并。代价是冲突清单可能很大（把 1 万文件复制到同名目录树上），因此弹窗需要 `totalCount` + 截断 + 默认「应用于全部」。

### 4.3 策略实现要点

- `overwrite`（Replace）：文件 vs 文件靠临时文件原子改名顶替；涉及目录的一侧先 `removeEntrySafely` 再发布。
- `skip`：跳过该项，不触碰目标；目录合并时只跳过冲突叶子。
- `keep-both`（可选，非 Windows 原生）：`uniquePath` → `name (1).ext`。
- `duplicate` 固定使用 `keep-both` 命名（`name - Copy`，对齐 Windows「复制副本」）。

---

## 5. Windows 资源管理器式 UI 交互规范

### 5.1 冲突对话框：`Replace or Skip Files`

对齐 Win10/11 的形态（多冲突时用单选 + 复选框，单冲突时用竖排按钮）：

```
┌──────────────────────────────────────────────────────────┐
│  Replace or Skip Files                              [×]  │
├──────────────────────────────────────────────────────────┤
│  3 conflicts                                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 📄 a.txt                 2.4 MB                    │  │
│  │ 📄 b.txt                 18 KB                     │  │
│  │ 📁 docs                  Folder                    │  │
│  └────────────────────────────────────────────────────┘  │
│  （超过 200 项时显示 “and 8,120 more”）                   │
│                                                          │
│  What do you want to do?                                 │
│   (•) Replace the file in the destination                │
│   ( ) Skip this file                                     │
│   ( ) Compare info for both files        ← Phase D 可选   │
│                                                          │
│  ☑ Do this for all current items                         │
│                                                          │
│                                    [ Continue ] [ Cancel ]│
└──────────────────────────────────────────────────────────┘
```

- 标题固定 `Replace or Skip Files`；副标题 `N conflicts` / `N files are already in this folder`。
- `kind` 决定措辞：`file-vs-file` → “Replace the file in the destination”；`file-vs-dir` / `dir-vs-file` → “Replace the folder/file in the destination”，并追加一行警示（Replace 会删除目标处的目录/文件）。
- 复选框在 `totalCount > 1` 时出现，映射 `applyToAll`。
- 「Compare info for both files」展开源/目标的大小与修改时间对照，允许逐项保留其一（Phase D）。
- **关闭对话框 = 取消任务**：Cancel（或 Esc 关闭弹窗）会取消任务并把它直接移出列表，不留等待决策的残局；目标文件保持原样。
- 多任务同时停在冲突时，弹窗排队，逐个展示。

### 5.2 进度面板：右下角常驻的 `Transfers / Tasks` 双页签

早期方案是复用 `ViewPortWindow` 做一个可拖动的资源管理器式进度对话框。落地后改成了**固定在右下角的常驻面板**（Google Drive 式），理由有三条：

1. 两类任务的归属完全不同，不该混在一个列表里。上传 / 下载**永远是浏览器侧的客户端任务**（HTTP 字节流 + 客户端队列）；复制 / 移动 / 删除 / 复制副本走**服务端任务**（WS 推送、可跨窗口可见）。混在一起时，页脚的「取消全部」到底取消哪一类说不清，顶部的百分比也会把两边的字节加在一起。
2. 窗口会盖住文件列表（§0.2 里就修过一次「结束后不关闭」），而常驻面板靠状态栏的一个按钮显示 / 隐藏，不阻挡列表操作。
3. 拖动 / 缩放对一个只读的进度面板没有价值，却带来焦点与层级问题。

```
                                            ┌─────────────────────────┐
                                            │ Transfers 3   Tasks 1  ×│
                                            │ 2/3 · 45.2/200 MB · 12MB/s│
                                            ├─────────────────────────┤
                                            │ ⏳ big.iso      45%  12MB/s│
                                            │ ✅ a.txt        Done      │
                                            │ ⏳ report.pdf   12%       │
                                            ├─────────────────────────┤
                                            │ ⇅ 2      [Retry All]  …  │
                                            └─────────────────────────┘
                                              ↑ 固定在状态栏上方，移动端整宽
```

- **两个页签**：`Transfers`（客户端上传 / 下载）与 `Tasks`（服务端任务）。页签上的角标优先级为「还在跑 > 有失败 > 记录条数」。
- **顶部汇总与页脚按钮都是按页签隔离的**：`Transfers` 页脚是并发数 / `Retry All` / `Clear Failed` / `Clear Success` / `Cancel All`，`Tasks` 页脚是 `Clear finished` / `Cancel All`。切换页签时汇总文字与按钮一起换。
- 布局：`right` 固定、`bottom` 让开桌面端的状态栏（显示 / 隐藏的入口按钮就在那里），宽 380px、`max-height` 60vh；移动端宽度 100% 且贴底（状态栏在窄屏会换行变高，留固定缝隙只会盖掉一半文字）。
- 显示 / 隐藏由状态栏的按钮控制（沿用既有入口）。**隐藏 ≠ 取消**：正在跑的传输继续跑，失败的也留着；隐藏时只丢掉已经成功的传输行。
- 新的客户端传输出现时自动弹出面板并切到 `Transfers` 页签，新的服务端任务出现时切到 `Tasks` 页签（两类活动各自激活自己的页签）；全部服务端任务到终态后自动收起，并顺手清掉「一次成功、没有任何问题」的记录，部分成功 / 失败的保留；取消的任务直接移除，不保留「已取消」状态。
- 服务端进度按**字节**计算（无字节信息时退化为条目数）；客户端速度按「已传字节增量 / 时间」在前端算，不占用服务端字段。
- 进度画在行自己身上：整行铺一层半透明的状态色（进行中 = primary，成功 = success，失败 / 部分成功 = danger），而不是在行底再塞一条进度条——行高与数据行完全一致，横向空间也不会被挤掉。
- 行图标分两层：主图标永远是任务类型（上传 = `progress-upload`，下载 = `progress-download`，后台任务 = 复制 / 移动 / 删除 / 复制副本），状态只画在右下角的小角标上（运行中 = 转圈，等冲突 = `pause-circle`，成功 = `check-circle`，失败 = `alert-circle`），所以任务跑起来时不会因为状态换掉类型图标。
- 不做暂停：§3.6 已确认取消是唯一控制手段；角标里的 `pause-circle` 只表示任务停在冲突上等用户决定，不是暂停功能。

组件的切分：`TransferPanel`（外壳 + 页签 + 插槽，不依赖任何数据来源）、`TransferList` / `ServerTaskList`（列表 + 虚拟滚动）、`TransferRow` / `ServerTaskRow`（纯展示行）、`TransferQueue`（编排层：客户端队列、进度聚合、面板显隐）。列表与行组件都不依赖面板，可以单独塞进别处。

### 5.3 错误对话框：`N items failed`

```
┌──────────────────────────────────────────────────────────┐
│  N items failed                                     [×]  │
├──────────────────────────────────────────────────────────┤
│  ☑ 📄 a.txt      Permission denied                       │
│  ☑ 📄 b.txt      The file is being used by another process│
│  ☐ 📄 c.txt      Path too long                           │
│                                                          │
│                          [ Try Again ] [ Skip ] [ Cancel ]│
└──────────────────────────────────────────────────────────┘
```

映射：`Try Again` = 用勾选的失败项重新 `create` 一个任务；`Skip` = 从列表移除；`Cancel` = 关闭。

### 5.4 拖拽与命名语义

- 拖拽默认效果：**同卷移动、跨卷复制**；`Ctrl` 强制复制，`Shift` 强制移动（与资源管理器一致）。跨卷判定由服务端在 `scanning` 阶段比对设备号，前端先按 `Ctrl/Shift` 传递意图，服务端可覆盖。
- 右键拖拽 → 上下文菜单（`Copy here` / `Move here`）。
- 拖到文件夹上：高亮目标文件夹，落下即进入。
- 拖到已存在的同名项 → 上面的冲突对话框。
- **在同一目录内复制** → 不询问，直接按 `name - Copy` / `name - Copy (2)` 命名（Windows 的「复制副本」行为），即 `duplicate`。
- 删除：保留现有确认弹窗，文案对齐「permanently delete … can not be undone」（没有回收站，不做 Undo）。
- 快捷键沿用资源管理器肌肉记忆：`Ctrl+C/X/V`、`Delete`、`F2`、`F5`（本项目里 F5 已规划为「复制到另一面板」，需要单独确认，见 §11 问题 5）。

### 5.5 与现有组件的映射

| 现有 | 改造 |
| --- | --- |
| `TransferQueue.vue` | 拆成两层：`TransferQueue` 只做编排（客户端队列、进度聚合、面板显隐），外观交给 `TransferPanel` + `TransferList` / `ServerTaskList` + `TransferRow` / `ServerTaskRow` |
| `ExplorerUI/conflict-dialog.ts` + `ConflictDialog.vue` | 承载 §5.1 的对话框，由 `conflict` 事件驱动 |
| `input-prompt.ts`（`window.$dialog`） | 不变 |

---

## 6. 一次带冲突的粘贴时序

```
用户 Ctrl+V
  │
  ├─ 前端：tasks.create(kind=copy, onConflict=ask)
  ├─ 服务端：queued → scanning；推送 update("Preparing to copy…")
  │           walk 源 + 目标合并子树：120 项 / 800MB，3 个冲突，磁盘零改动
  ├─ 服务端：awaiting-conflict + conflict{ 3 items }
  ├─ 前端：Replace or Skip Files 弹窗；用户选 Replace + Do this for all
  │         → tasks.resolve(taskId, overwrite, applyToAll=true)
  ├─ 服务端：running；每 250ms 推送进度（每个文件 tmp → rename 原子发布）
  ├─ 用户点 Pause → 当前文件收尾后 paused；Resume → 继续
  ├─ 用户点 Cancel → ctx 取消 → 删 tmp → 任务直接移出列表（无半个文件）
  └─ 服务端：done{ state, results }
              + fs changed 广播 → 前端刷新命中目录、更新剪贴板、汇总提示
```

---

## 7. 前端改造清单

| 位置 | 改动 |
| --- | --- |
| `api/filesystem.ts` | 删除 `copyPaste`、`deleteEntry` |
| `api/tasks-ws.ts`（新） | 任务命令封装（create/cancel/pause/resume/resolve/list/dismiss） |
| `store/tasks.ts`（新） | 任务 store：`snapshot` 全量替换、`update` 合并 patch、`done` 终态、`conflict` 入队 |
| `store/fs-events.ts`（新） | `fs changed` 订阅与面板刷新分发 |
| `hooks/use-copy-paste.ts` | `handlePaste` → `create` 任务；删除前端预检与 `moveRefresh`；剪贴板清理改由 `done` 驱动 |
| `hooks/use-file-actions.ts` | `doDeleteSelected` → delete 任务；`handleDuplicate` → duplicate 任务（删掉临时目录三段式） |
| `use-transfer.ts` / `TransferQueue.vue` | 演进为 `TaskCenter.vue`，上传/下载行并入同一 store（`source: 'client'`） |
| `ExplorerUI/conflict-dialog.ts` / `ConflictDialog.vue` | 改为 `conflict` 事件驱动 + 弹窗队列 |
| `use-navigation.ts` | 订阅 `fs changed` |
| `types/server.ts` | 扩展 `WsScope`，新增 tasks / fs 消息类型 |
| `api/shared-ws.ts` | 基本不动 |

后端删除路由：`POST /files/copy-paste`、`POST /files/delete`。

---

## 8. 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 广播被慢客户端阻塞 | 现有同步写会拖垮全局 | §3.8 出站队列 + 合并，**本次最易被低估的一项** |
| 进度事件风暴 | 上万小文件 | 服务端 250ms 节流 + 客户端 rAF |
| fsync 拖慢小文件 | 完整性 vs 速度 | 配置开关 `copyFsync`，默认开 |
| tmp 残留 | 崩溃/断电 | 列表与 zip 前缀过滤（不自动清理，见 0.3） |
| 合并语义下冲突量巨大 | 同名目录树 | `totalCount` + 截断 + 默认「应用于全部」 |
| 预扫描双倍遍历 | 源 + 目标合并子树 | 已接受；大目录首次等待需在 UI 上显示为 `Preparing…` |
| 暂停延迟 | 只在文件边界生效 | UI 显示「正在暂停…」，不假装瞬时 |
| 服务重启丢任务 | 纯内存注册表 | UI 提示；需要恢复能力时再上持久化日志 |
| 任务无主 | 所有客户端可取消 | 单用户自托管可接受；多用户需 owner 校验 |
| 文件↔目录 Replace 有空窗 | 必须先删再发布 | 弹窗文案说明；仅此一处无法原子 |

---

## 9. 分阶段实施

**Phase A —— 服务端原语（可单测，不碰 WS）**
1. 新建 `fileops`，迁移 `copyEntry/copyDir/copyFile/copyLink/removeEntrySafely`，全部 ctx 感知。
2. `tempfile.go`：临时文件命名（同目录 + 随机后缀）；`getFiles` 与 `zipPath` 过滤前缀。
3. `scan.go`：条目/字节统计 + 冲突清单（含目录合并的递归探测）。
4. `conflict.go`：Windows 语义（目录合并、file↔dir 的 Replace/Skip）+ `uniquePath`。
5. 单测：策略矩阵、ctx 取消后无 tmp 残留、结果集上限、move 的 EXDEV 回退、链接语义。

**Phase B —— 任务管理器 + WS scope**
6. `tasks` 包：注册表、状态机、并发闸门、节流上报、取消、暂停、TTL。
7. `routes/tasks_ws.go` + `shared_ws.go` 增加 `tasks` / `fs` case。
8. 传输层加固：出站队列、心跳、写超时。

**Phase C —— 前端接入**
9. `store/tasks.ts` + `store/fs-events.ts` + `api/tasks-ws.ts`。
10. `use-copy-paste` / `use-file-actions` 切任务模型；删前端预检与 `moveRefresh`。
11. `ConflictDialog` 改为事件驱动 + 弹窗队列 + Explorer 文案。
12. `TaskCenter.vue`：进度窗口 + More details + Pause/Resume + Cancel + 错误对话框。
13. 删除后端 `copy-paste` / `delete` 路由与前端 API。

**Phase D —— 打磨**
14. `Compare info for both files`；重试/暂停细节；任务历史；header 角标。
15. 拖拽语义（跨卷判定、右键拖拽菜单）与多面板方案合流。
16. CHANGELOG 与版本号同步。

---

## 10. 验收要点

1. 取消发生在写大文件中途 → 目标目录里**没有**该文件的任何残留（既没有半个文件，也没有 tmp）。
2. 进程被 `kill -9` → 残留的 `.fl-part-*` 在列表和 zip 里都看不到（不自动清理）。
3. 暂停时当前文件仍然完整落盘，恢复后继续。
4. 目录合并：把 `docs/` 复制到已有 `docs/`，不询问目录本身，只询问内部同名文件。
5. 「Do this for all current items」后不再重复弹窗。
6. 断线 5 分钟再连上 → `list` 对账，进度正确、暂停态正确；停在冲突上的任务仍可决策。
7. 第二个浏览器窗口能看到并取消第一个窗口发起的任务。
8. 全部成功时进度窗口自动关闭；有失败时弹出失败清单且 Try Again 只重跑失败项。

---

## 11. 待拍板项

1. **Keep both（保留两者）**：Windows 资源管理器没有这个选项。是否作为附加按钮保留？（`duplicate` 仍会用它做自动命名。）
2. **Compare info for both files**：本期做还是留到 Phase D？（需要读两侧 size/mtime，已经有数据，成本主要在 UI。）
3. **进度窗口形态**：单任务时用资源管理器式的模态/浮动进度对话框（本方案），还是所有任务统一在 `TaskCenter` 面板里列表化？
4. **fsync 默认值**：默认开（更强完整性，小文件更慢）还是默认关（更快，断电可能留下已改名但内容未落盘的文件）？
5. **`F5` 冲突**：多面板方案里把 `F5` 规划为「复制到另一面板」，而资源管理器的 `F5` 是刷新。哪个优先？
6. **暂停深度**：只在文件边界暂停（实现简单、保证完整性），还是支持文件内暂停（响应更快，但要处理部分写入）？本方案选前者。
7. **多用户**：是否现在就加任务 owner 校验，还是维持「所有人可见可取消」？
