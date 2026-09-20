# 浏览器挂载的本地文件夹（File System Access API）

> 状态：**已实现**（1.5.0）。本文说明「挂载本机文件夹」这条链路的边界与实现，
> 并先把两个经常被混为一谈的 API 分清楚。
>
> 一句话范围：把本机的一个文件夹挂成侧边栏位置，浏览、读写与播放都在浏览器里完成。
> 它走的是 **File System Access API**，和 **OPFS** 没有关系。

## 1. 先分清两个 API

两者共用的只有**句柄类型**（`FileSystemDirectoryHandle` / `FileSystemFileHandle`）与
那套读写方法，概念、入口和用途都不同：

| | **File System Access API** | **OPFS**（Origin Private File System） |
| --- | --- | --- |
| 入口 | `showDirectoryPicker()` / `showOpenFilePicker()` / `showSaveFilePicker()` | `navigator.storage.getDirectory()` |
| 指向什么 | 用户在系统选择框里挑的**真实磁盘位置**（及其后代） | 源私有、用户与操作系统都看不见的**沙箱存储** |
| 用户能挑吗 | 能，每次挂载都由用户自己选 | 不能，也没有「挂载」这个概念 |
| 权限 | `queryPermission` / `requestPermission`（`read` / `readwrite`），跨刷新要重新确认 | 同源即可用，没有授权流程 |
| 本项目的用途 | **挂载文件夹功能**；`downloadToFolder` 也用它选目标目录 | **仅 e2e**：给目录选择框打桩 |

**为什么不用 OPFS 实现挂载。** 这个功能的目标是访问用户的真实文件——就地播放媒体、
编辑文本、与服务端双向复制。OPFS 是与宿主磁盘隔离的同源沙箱：用户无法把已有目录放进
去，在资源管理器里也看不到。用它等于把「挂载本机文件夹」变成「在浏览器里再建一个私有
目录」，不是同一件事。

> 生产代码里**没有任何一处**使用 `navigator.storage.getDirectory()`。仓库里出现 OPFS
> 只可能在 `e2e/`，含义固定是「测试替身」（见 §6）。

## 2. 代码落点

| 文件 | 职责 |
| --- | --- |
| `frontend/src/views/FileManager/ExplorerUI/mounted-volumes.ts` | 挂载表：挂载 / 卸载、句柄持久化、权限状态、侧边栏数据 |
| `frontend/src/utils/fs/browser-backend.ts` | 读写原语（`FileSystemHandle` → `IEntry` / `File`），不含挂载表 |
| `frontend/src/utils/fs/index.ts` | 唯一分派点 `backendFor(path)`：`isMountedPath` 为真走浏览器后端，否则走服务端 |
| `frontend/src/views/FileManager/ExplorerUI/client-tasks.ts` | 跨浏览器 / 服务端的复制、移动、删除（客户端任务） |
| `frontend/src/views/FileManager/ExplorerUI/hooks/use-transfer.ts` | `downloadToFolder` 用 `showDirectoryPicker()` 选目标目录，与挂载表无关的一次性使用 |

`mounted-volumes.ts` 通过 `setMountedHandleResolver` / `setMountedWriteGuard` /
`setMountedWriteFailureReporter` 把句柄和权限状态注入共享层，所以共享层不依赖视图层，
调用点也不必自己判断「这条路径属于哪一侧」。

## 3. 挂载与恢复

- **挂载**必须在用户手势里调用 `showDirectoryPicker({ mode: 'readwrite' })`：选择框
  与授权弹窗都只在手势有效期内被浏览器处理。用户取消（`AbortError`）不是错误。
- **句柄持久化**在 IndexedDB（库 `file-lite-browser-mounts`、store `volumes`，
  `keyPath: 'meta.id'`）；IndexedDB 不可用时退化成内存 Map，代价只是刷新后要重新挂载。
- **恢复不申请权限**：页面加载时没有用户手势，`requestPermission` 会被直接拒绝。
  能静默 `queryPermission` 到 `granted` 的按可用处理，其余标记为 `prompt`，由侧边栏
  显示「Remount」，用户点一次再走授权流程。
- **状态有四种**：`granted`（读写）、`read-only`（只批了读）、`prompt`（需要再授权）、
  `denied`。它们对应不同的出路（补授权 / 重新挂载 / 卸载），所以界面分别说清楚，
  而不是笼统一句「权限不足」。
- 权限查询按 `readwrite` 先问、再退回 `read`——否则一个只批了读的句柄会被误判成可写，
  等用户新建文件时才失败。

## 4. 路径命名空间与分派

- 挂载卷在应用路径空间里的前缀是 `/@mounted/<id>`（`MOUNTED_PATH_PREFIX`，
  `frontend/src/utils/fs/paths.ts`）。`<id>` 只允许自己生成的形态，避免段分隔符造成解析歧义。
- `isMountedPath` 是**唯一**的判断点：`backendFor` 据此在浏览器后端与服务端之间分流。
  这条路径**绝不能发给服务端**——后端解析不了它。e2e 用接口审计断言「没有任何
  `/@mounted` 请求」来防止分流漏点。
- 挂载根同时是**导航边界**：面包屑第一段是卷标，`canGoUp` 到卷根为止，不会退回
  `/@mounted` 这个后端不认识的前缀。

## 5. 读写能力与边界

- 浏览、读文件、新建文件 / 文件夹、重命名、删除、文本编辑器保存都由浏览器后端完成；
  写操作统一先过只读守卫（`mount-write.ts`），返回可展示的原因。
- 同一卷内的移动 / 重命名**先试**浏览器原生的 `FileSystemFileHandle.move()`（浏览器直接
  改目录项，零拷贝）。这条快路径并不可靠：`move()` 是 Chromium 的扩展，主要实现在 OPFS
  上，用户用系统弹窗挑选的本地文件夹上未必可用。所以拿不到或调用失败时退回
  「流式复制 + 删源」；目录句柄一般没有 `move()`，整棵目录树走的就是这条兜底。
- 移动一个目录时，内容搬完（且其下没有失败项）才删掉源目录，否则会在源位置留下一个
  空目录；复制 / 移动目录树时目标父级会逐段创建，不能假定它已经由某个文件写入带出来。
- 跨「服务端 ⇄ 挂载卷」以及两个挂载卷之间的复制、移动、删除走**客户端任务**
  （`needsClientExecution` 判定），因此即使服务端完全看不到那个文件夹也能工作。
  注意：源在服务端、目标在挂载卷的**移动**，客户端只能把内容搬过来，删源要走服务端
  删除任务，目前没有接上（表现为源仍在）。
- 两个能力明确留在服务端：**视频缩略图**与**图片降采样**；挂载卷里的这类文件显示
  类型图标。
- 只支持实现了 `showDirectoryPicker` 的浏览器（Chromium）。不支持时整个挂载区不渲染
  ——给一个点了没反应的入口比没有更糟。

## 6. OPFS 在本仓库的唯一位置：e2e 打桩

`e2e/tests/12-mounted-folder.spec.ts` 需要绕开系统选择框，同时又能直接读写被挂载的
目录。OPFS 恰好返回同一种句柄、且测试代码可以直接操作它，所以桩把
`navigator.storage.getDirectory()` 与 `showDirectoryPicker()` 指向同一个 OPFS 目录：

- 断言因此能一路验到「文件真的落到了那个目录里」，而不只是看界面；
- 这个桩**只存在于测试**，生产代码里没有任何测试开关；
- 桩目录按 profile 持久，所以每个用例用独立目录名并只 seed 一次。

用例文件里的 OPFS 一律指这个替身，不代表应用行为。相关约束（Chromium 从 IndexedDB
读回 `FileSystemDirectoryHandle` 会崩渲染进程而跳过恢复用例）见
[`e2e/README.md`](../../e2e/README.md)。

## 7. 与后端挂载表的关系

挂载卷**不并进** `drives.ts` 的 `driveList`：那份列表同时是后端跨卷判定（移动 / 复制）
的输入，一条后端解析不了的路径混进去会让拖拽选错模式。挂载卷只贡献导航边界
（`mountedVolumeBoundaryPaths`），两者读同一份数据但用途不同。

后端侧的本地 / UNC / WSL / 系统挂载点属于另一套东西，见
[`vfs-abstraction-design.md`](./vfs-abstraction-design.md)。