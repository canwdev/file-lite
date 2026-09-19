import type { TaskEntry } from '@/store/task-state'
/**
 * 浏览器挂载卷参与的复制 / 移动 / 删除任务（客户端执行）。
 *
 * 服务端的执行器（`backend-go/fileops`）只认识「路径 → os.*」，而挂载卷的内容在
 * 浏览器里，后端根本无法解析 `/@mounted/...`。所以只要一次操作碰到挂载卷，就必须
 * 由前端执行；这个模块就是那个执行器。
 *
 * 三条原则：
 *
 * 1. **形态与服务端任务一致**。产出同一套 `TaskSnapshot` / `TaskItemResult`，
 *    进同一个任务列表、同一个失败清单，调用方（剪贴板 / 拖拽 / 目录补丁）不需要
 *    知道这次操作是前端跑的。
 * 2. **跨端是组合，不是特例**。源与目标各自解析成「浏览器卷」或「服务端」，
 *    四种组合走同一段代码：读一侧 → 写另一侧。
 * 3. **字节搬运复用既有通道**。上传走 `fsWebApi.uploadFile`（临时文件 + 原子改名），
 *    下载走 `/stream` + `pipeTo(writable)`——与 `TransferQueue.vue` 的下载同一条路，
 *    由流标准提供背压，不会把大文件缓冲进内存。
 */
import type { ConflictPolicy, TaskItemResult, TaskItemStatus, TaskSnapshot, TaskState, TaskStats } from '@/types/server'
import { fsWebApi } from '@/api/filesystem'
import { authToken } from '@/store/auth'
import {
  fireTaskDone,
  openFailureDialog,
  requestLocalConflict,
  taskList,
} from '@/store/task-state'
import explorerBus, { ExplorerEvents } from '../utils/bus'
import {
  createMountedDir,
  mountedEntryExists,
  readMountedDir,
  readMountedFile,
  removeMountedEntry,
  writeMountedFileFromStream,
} from './browser-fs'
import { isMountedPath, needsClientExecution } from './mounted-volumes'

/** 客户端任务的 id 前缀：与服务端分配的 id 不可能相撞，也便于识别。 */
export const CLIENT_TASK_PREFIX = 'clienttask_'

/** 该任务 id 是不是本执行器生成的（服务端分配的 id 不会带这个前缀）。 */
export function isClientTaskId(taskId: string): boolean {
  return taskId.startsWith(CLIENT_TASK_PREFIX)
}

export { needsClientExecution }

let sequence = 0

/** 客户端任务跑在浏览器里，没有服务端的「等待决策」中间态，所以取消也由本地记着。 */
const cancelledTasks = new Set<string>()

/** 正在跑的任务的中止器：取消要能打断在途的请求，而不是等它跑完。 */
const abortControllers = new Map<string, AbortController>()

export interface ClientTaskRequest {
  kind: TaskSnapshot['kind']
  fromPaths: string[]
  toPath: string
  onConflict?: ConflictPolicy
}

/** 待搬运的一个条目（目录树已摊平）。 */
interface PendingItem {
  /** 源绝对路径 */
  fromPath: string
  /** 相对目标根的位置（`folder/a.txt`） */
  relativePath: string
  isDirectory: boolean
  size: number
  /** 上传进度用：上一次已上报的字节，避免重复累加 */
  uploadedBytes?: number
}

interface RunContext {
  taskId: string
  state: TaskState
  /** 取消时中止正在进行的请求 / 写入 */
  abort: AbortController
  policy: ConflictPolicy
  results: TaskItemResult[]
  itemsTotal: number
  itemsDone: number
  itemsSucceeded: number
  itemsSkipped: number
  bytesTotal: number
  bytesDone: number
  currentPath: string
}

// ---------------------------------------------------------------------------
// 任务记录的增删改
// ---------------------------------------------------------------------------

function pushTask(snapshot: TaskSnapshot) {
  taskList.value = [...taskList.value.filter(task => task.id !== snapshot.id), snapshot]
}

function patchTask(taskId: string, patch: Partial<TaskEntry>) {
  taskList.value = taskList.value.map(task => (task.id === taskId ? { ...task, ...patch } : task))
}

function newTaskId(): string {
  sequence += 1
  return `${CLIENT_TASK_PREFIX}${Date.now()}_${sequence}`
}

function statsOf(ctx: RunContext): TaskStats {
  return {
    succeeded: ctx.itemsSucceeded,
    skipped: ctx.itemsSkipped,
    renamed: 0,
    failed: ctx.results.filter(item => item.status === 'failed').length,
    conflict: ctx.results.filter(item => item.status === 'conflict').length,
  }
}

function progressOf(ctx: RunContext) {
  return {
    itemsTotal: ctx.itemsTotal,
    itemsDone: ctx.itemsDone,
    bytesTotal: ctx.bytesTotal,
    bytesDone: ctx.bytesDone,
    currentPath: ctx.currentPath,
  }
}

/** 每次条目完成 / 字节推进时刷新任务快照（行的进度与文案都读它）。 */
function publish(ctx: RunContext) {
  if (cancelledTasks.has(ctx.taskId)) {
    return
  }
  patchTask(ctx.taskId, {
    state: ctx.state,
    progress: progressOf(ctx),
    stats: statsOf(ctx),
  })
}

function isCancelled(ctx: RunContext): boolean {
  return cancelledTasks.has(ctx.taskId)
}

/**
 * 只保留有问题的条目：一个几百项的复制任务没必要把成功记录全留着，
 * 失败清单（`failedItemsOf`）只需要失败与冲突项。
 */
function importantResults(results: TaskItemResult[]): TaskItemResult[] {
  return results.filter(item => item.status === 'failed' || item.status === 'conflict')
}

/** 收尾：写终态、通知 `onTaskDone`，并清掉取消标记。 */
function finishTask(ctx: RunContext, crash?: unknown) {
  const stats = statsOf(ctx)
  const problematic = stats.failed + stats.conflict
  const produced = ctx.results.length - problematic

  let state: TaskState
  if (cancelledTasks.has(ctx.taskId)) {
    state = 'cancelled'
  }
  else if (crash) {
    state = produced > 0 ? 'partial' : 'failed'
  }
  else if (problematic > 0) {
    state = produced > 0 ? 'partial' : 'failed'
  }
  else {
    state = 'succeeded'
  }

  const error = crash
    ? (crash instanceof Error ? crash.message : String(crash))
    : undefined

  patchTask(ctx.taskId, {
    state,
    canCancel: false,
    finishedAt: Date.now(),
    error,
    progress: progressOf(ctx),
    stats,
    results: importantResults(ctx.results),
    resultsTruncated: false,
  })

  const task = taskList.value.find(item => item.id === ctx.taskId)
  if (!task) {
    cancelledTasks.delete(ctx.taskId)
    return
  }

  const results = importantResults(ctx.results)
  const failed = stats.failed + stats.conflict

  // 收尾延后一个宏任务再发。
  //
  // `createTask` 是「同步建好任务、返回 id」，而调用方在它返回之后才注册
  // `onTaskDone`（见 `use-copy-paste.ts`）。一个只剩几个小文件的客户端任务完全
  // 可能在 `run` 的第一段 await 里就跑完，那时回调还没登记，完成通知就会掉进
  // 空处——剪贴板不会对账、失败清单也不会弹。延后一拍让调用方先登记完。
  setTimeout(() => {
    cancelledTasks.delete(ctx.taskId)
    // 通知落在同样目录里的列表刷新：这类任务没有服务端的 fs changed 推送
    explorerBus.emit(ExplorerEvents.CLIENT_TASK_DONE, { task, results })
    fireTaskDone(task, results, false)
    if (failed > 0 && locallyCreatedTaskIds.has(ctx.taskId)) {
      openFailureDialog(ctx.taskId)
    }
  }, 0)
}

/**
 * 本窗口发起的客户端任务：只有它们才自动弹失败清单，与服务端任务同一套规则
 * （见 `store/tasks.ts` 的 `locallyCreatedTasks`）。
 */
const locallyCreatedTaskIds = new Set<string>()

/** 由 `store/tasks.ts` 在派发时登记，保证「谁发起谁弹清单」的语义一致。 */
export function markLocallyCreated(taskId: string): void {
  locallyCreatedTaskIds.add(taskId)
}

// ---------------------------------------------------------------------------
// 冲突
// ---------------------------------------------------------------------------

/**
 * 冲突预检 + 用户决策。
 *
 * 复用上传那条本地冲突通道（`requestLocalConflict`），所以「替换 / 跳过 / 两个都
 * 保留」的语义与上传完全一致。返回 null 表示用户取消整批操作。
 */
async function resolvePolicy(
  items: PendingItem[],
  destPath: string,
  isMove: boolean,
  requested: ConflictPolicy,
): Promise<ConflictPolicy | null> {
  if (requested !== 'ask') {
    return requested
  }

  const targetRoot = destPath.replace(/\/+$/, '')
  const conflicts: PendingItem[] = []
  for (const item of items) {
    if (item.isDirectory) {
      continue
    }
    const target = `${targetRoot}/${item.relativePath}`
    const hit = isMountedPath(target)
      ? await mountedEntryExists(parentDirOf(target), lastSegment(target))
      : await serverEntryExists(target)
    if (hit) {
      conflicts.push(item)
    }
  }

  if (!conflicts.length) {
    return 'overwrite'
  }

  const resolution = await requestLocalConflict({
    destPath,
    isMove,
    totalCount: conflicts.length,
    truncated: false,
    action: isMove ? 'Move' : 'Copy',
    conflicts: conflicts.map(item => ({
      relativePath: item.relativePath,
      kind: 'file-vs-file' as const,
      sourceIsDirectory: false,
      destIsDirectory: false,
      sourceSize: item.size,
    })),
  })

  if (!resolution) {
    return null
  }
  return resolution.policy
}

async function serverEntryExists(path: string): Promise<boolean> {
  try {
    const { existing } = await fsWebApi.checkExists([path])
    return existing.includes(path)
  }
  catch {
    // 预检失败不该阻断操作：交给真正的写入去报错
    return false
  }
}

// ---------------------------------------------------------------------------
// 遍历
// ---------------------------------------------------------------------------

async function readDirForTask(path: string) {
  if (isMountedPath(path)) {
    return readMountedDir(path, { showHidden: true })
  }
  const list = await fsWebApi.getList({ path }, { isToast: false })
  return Array.isArray(list) ? list : []
}

interface WalkedEntry {
  relativePath: string
  isDirectory: boolean
  size: number
}

async function walkDirectory(path: string, prefix = ''): Promise<WalkedEntry[]> {
  const list = await readDirForTask(path)
  const out: WalkedEntry[] = []
  for (const entry of list) {
    if (entry.error) {
      continue
    }
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      out.push({ relativePath, isDirectory: true, size: 0 })
      out.push(...await walkDirectory(joinPath(path, entry.name), relativePath))
    }
    else {
      out.push({ relativePath, isDirectory: false, size: entry.size ?? 0 })
    }
  }
  return out
}

/** 把若干源路径展开成待搬运条目：先确定总量，进度才不会边跑边变。 */
async function collectItems(fromPaths: string[]): Promise<PendingItem[]> {
  const items: PendingItem[] = []
  for (const fromPath of fromPaths) {
    const parent = parentDirOf(fromPath)
    const name = lastSegment(fromPath)
    const entry = (await readDirForTask(parent)).find(item => item.name === name)
    if (!entry) {
      throw new Error(`Source path does not exist: ${fromPath}`)
    }

    if (!entry.isDirectory) {
      items.push({ fromPath, relativePath: name, isDirectory: false, size: entry.size ?? 0 })
      continue
    }

    // 目录本身要落到目标下（复制文件夹 = 把它的内容装进同名目录）
    for (const child of await walkDirectory(fromPath, name)) {
      items.push({
        fromPath: joinPath(fromPath, child.relativePath.slice(name.length + 1)),
        relativePath: child.relativePath,
        isDirectory: child.isDirectory,
        size: child.size,
      })
    }
  }
  return items
}

// ---------------------------------------------------------------------------
// 字节搬运
// ---------------------------------------------------------------------------

/** 服务端 → 挂载卷：流式下载并直接写入目标句柄。 */
async function downloadToBrowser(
  srcPath: string,
  destDir: string,
  filename: string,
  ctx: RunContext,
): Promise<void> {
  const response = await fetch(fsWebApi.getStreamUrl(srcPath), {
    headers: { Authorization: authToken.value },
    signal: ctx.abort.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }

  const progressStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      ctx.bytesDone += chunk.byteLength
      publish(ctx)
      controller.enqueue(chunk)
    },
  })

  await writeMountedFileFromStream(destDir, filename, response.body.pipeThrough(progressStream))
}

/** 挂载卷 → 服务端：取出 File 后走既有上传通道。 */
async function uploadToServer(
  srcPath: string,
  destPath: string,
  ctx: RunContext,
  item: PendingItem,
): Promise<void> {
  const file = await readMountedFile(srcPath)
  await fsWebApi.uploadFile(
    { path: destPath, file, onConflict: uploadPolicyOf(ctx.policy) },
    {
      signal: ctx.abort.signal,
      onUploadProgress(event: { loaded?: number }) {
        const loaded = event.loaded ?? 0
        ctx.bytesDone += Math.max(loaded - (item.uploadedBytes ?? 0), 0)
        item.uploadedBytes = loaded
        publish(ctx)
      },
    },
  )
}

function uploadPolicyOf(policy: ConflictPolicy): 'error' | 'overwrite' | 'keep-both' {
  if (policy === 'skip') {
    // 跳过在任务层已经处理掉了，走到上传说明要写
    return 'error'
  }
  return policy === 'keep-both' ? 'keep-both' : 'overwrite'
}

/** 挂载卷 → 挂载卷：读出来再写进去（同卷时浏览器内部会走高效路径）。 */
async function copyInsideBrowser(srcPath: string, destDir: string, filename: string, ctx: RunContext, item: PendingItem): Promise<void> {
  const file = await readMountedFile(srcPath)
  await createMountedDir(destDir)
  await writeMountedFileFromStream(destDir, filename, file.stream())
  ctx.bytesDone += item.size
  publish(ctx)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 执行一次涉及挂载卷的复制 / 移动 / 删除。
 *
 * 返回任务 id；函数本身不等任务跑完。进度通过 `taskList` 推送，完成时走
 * `onTaskDone`（与 `store/tasks.ts` 的服务端任务完全同一条路）。
 */
export function createClientTask(request: ClientTaskRequest): string {
  const taskId = newTaskId()
  const isMove = request.kind === 'move'
  const now = Date.now()

  pushTask({
    id: taskId,
    kind: request.kind,
    state: 'scanning',
    fromPaths: request.fromPaths,
    toPath: request.kind === 'delete' ? undefined : request.toPath,
    isMove,
    progress: { itemsTotal: 0, itemsDone: 0, bytesTotal: 0, bytesDone: 0 },
    stats: { succeeded: 0, skipped: 0, renamed: 0, failed: 0, conflict: 0 },
    canCancel: true,
    createdAt: now,
    startedAt: now,
  })

  const ctx: RunContext = {
    taskId,
    state: 'scanning',
    policy: request.onConflict ?? 'overwrite',
    abort: new AbortController(),
    results: [],
    itemsTotal: 0,
    itemsDone: 0,
    itemsSucceeded: 0,
    itemsSkipped: 0,
    bytesTotal: 0,
    bytesDone: 0,
    currentPath: '',
  }

  abortControllers.set(taskId, ctx.abort)

  void run(request, ctx).catch((error) => {
    console.error('[client-tasks] task crashed', error)
    finishTask(ctx, error)
  }).finally(() => {
    abortControllers.delete(taskId)
  })

  return taskId
}

async function run(request: ClientTaskRequest, ctx: RunContext): Promise<void> {
  const { fromPaths, toPath, kind } = request
  const isDelete = kind === 'delete'
  const isMove = kind === 'move'

  try {
    // ---- 删除：逐条递归删，不需要展开（服务端也是这个语义） ----
    if (isDelete) {
      ctx.itemsTotal = fromPaths.length
      ctx.state = 'running'
      publish(ctx)
      for (const path of fromPaths) {
        if (isCancelled(ctx)) {
          break
        }
        ctx.currentPath = path
        try {
          await removeMountedEntry(path)
          ctx.itemsDone += 1
          ctx.itemsSucceeded += 1
          ctx.results.push({ fromPath: path, status: 'deleted' })
        }
        catch (error) {
          ctx.results.push({ fromPath: path, status: 'failed', message: messageOf(error) })
        }
        publish(ctx)
      }
      finishTask(ctx)
      return
    }

    // ---- 1. 展开源 ----
    const items = await collectItems(fromPaths)
    ctx.itemsTotal = items.filter(item => !item.isDirectory).length
    ctx.bytesTotal = items.reduce((sum, item) => sum + item.size, 0)
    ctx.state = 'running'
    publish(ctx)

    // ---- 2. 冲突决策：取消就整批不做 ----
    const policy = await resolvePolicy(items, toPath, isMove, ctx.policy)
    if (policy === null) {
      // 与服务端一致：取消不留残局
      taskList.value = taskList.value.filter(task => task.id !== ctx.taskId)
      return
    }
    ctx.policy = policy

    // ---- 3. 逐条搬运 ----
    const targetRoot = toPath.replace(/\/+$/, '')
    for (const item of items) {
      if (isCancelled(ctx)) {
        break
      }
      if (item.isDirectory) {
        await createDirAt(`${targetRoot}/${item.relativePath}`)
        continue
      }

      const destPath = `${targetRoot}/${item.relativePath}`
      const destDir = parentDirOf(destPath)
      const destName = lastSegment(destPath)
      ctx.currentPath = item.fromPath

      // 跳过：目标已存在则不动它。只在复制时有意义（移动的源必须搬走）
      if (ctx.policy === 'skip' && !isMove && await existsAt(destPath)) {
        ctx.itemsDone += 1
        ctx.itemsSkipped += 1
        ctx.results.push({ fromPath: item.fromPath, toPath: destPath, status: 'skipped' })
        publish(ctx)
        continue
      }

      try {
        const sourceIsBrowser = isMountedPath(item.fromPath)
        const destIsBrowser = isMountedPath(destPath)

        if (sourceIsBrowser && destIsBrowser) {
          await copyInsideBrowser(item.fromPath, destDir, destName, ctx, item)
        }
        else if (sourceIsBrowser) {
          await uploadToServer(item.fromPath, destPath, ctx, item)
        }
        else {
          await createMountedDir(destDir)
          await downloadToBrowser(item.fromPath, destDir, destName, ctx)
        }

        ctx.itemsDone += 1
        ctx.itemsSucceeded += 1
        ctx.results.push({ fromPath: item.fromPath, toPath: destPath, status: statusFor(isMove) })
      }
      catch (error) {
        ctx.results.push({ fromPath: item.fromPath, toPath: destPath, status: 'failed', message: messageOf(error) })
      }
      publish(ctx)
    }

    // ---- 4. 移动：只删真正搬成功的源，避免「搬丢了」 ----
    if (isMove && !isCancelled(ctx)) {
      await removeMovedSources(ctx)
    }

    finishTask(ctx)
  }
  catch (error) {
    finishTask(ctx, error)
  }
}

async function removeMovedSources(ctx: RunContext): Promise<void> {
  const moved = ctx.results.filter(item => item.status === 'moved')
  for (const item of moved) {
    if (isCancelled(ctx)) {
      return
    }
    if (!isMountedPath(item.fromPath)) {
      // 服务端任务不会走到这里；真走到说明源应该在服务端删，那不该由前端做
      continue
    }
    try {
      await removeMountedEntry(item.fromPath)
    }
    catch (error) {
      ctx.results.push({
        fromPath: item.fromPath,
        status: 'failed',
        message: `moved, but the source could not be removed: ${messageOf(error)}`,
      })
    }
  }
}

function statusFor(isMove: boolean): TaskItemStatus {
  return isMove ? 'moved' : 'copied'
}

async function createDirAt(path: string): Promise<void> {
  if (isMountedPath(path)) {
    await createMountedDir(path)
    return
  }
  await fsWebApi.createDir({ path, ignoreExisted: true })
}

async function existsAt(path: string): Promise<boolean> {
  if (isMountedPath(path)) {
    return mountedEntryExists(parentDirOf(path), lastSegment(path))
  }
  return serverEntryExists(path)
}

/** 取消一个客户端任务：中止在途请求，已完成的条目保留。 */
export function cancelClientTask(taskId: string): void {
  cancelledTasks.add(taskId)
  abortControllers.get(taskId)?.abort()
  abortControllers.delete(taskId)
  patchTask(taskId, { canCancel: false })
}

/** 从列表里移除一个客户端任务；正在跑的会同时被取消。 */
export function dismissClientTask(taskId: string): void {
  cancelledTasks.add(taskId)
  taskList.value = taskList.value.filter(task => task.id !== taskId)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function lastSegment(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? ''
}

function parentDirOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  return cut > 0 ? trimmed.slice(0, cut) : trimmed
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, '')}/${name}`
}
