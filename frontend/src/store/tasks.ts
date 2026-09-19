import type { ConflictRequest, TaskEntry } from './task-state'
import type {
  ConflictPolicy,
  FsServerMessage,
  TaskItemResult,
  TasksDoneMessage,
  TaskSnapshot,
  TasksServerMessage,
} from '@/types/server'
import { watch } from 'vue'
import { ensureSharedWsConnected, sharedWsStatus, subscribeSharedWsMessage } from '@/api/shared-ws'
import {
  newTaskRequestId,
  sendCancelTask,
  sendCreateTask,
  sendDismissTask,
  sendListTasks,
  sendResolveConflict,
  sendRetryTask,
} from '@/api/tasks-ws'
import { authToken } from '@/store/auth'
import {
  cancelClientTask,
  createClientTask,
  dismissClientTask,
  isClientTaskId,
  markLocallyCreated,
  needsClientExecution,
} from '@/views/FileManager/ExplorerUI/client-tasks'
import {
  conflictDialogVisible,
  conflictQueue,
  dropConflictRequestByTask,
  dropTaskDone,
  emitFsChanged,
  failureDialogTaskId,
  fireTaskDone,
  openFailureDialog,
  setConflictResolver,
  setTaskCanceller,
  setTaskDismisser,
  taskList,
} from './task-state'

export type { ConflictRequest, ConflictResolution, FsChangedListener, TaskEntry } from './task-state'
export {
  closeFailureDialog,
  conflictDialogVisible,
  conflictQueue,
  failedItemsOf,
  failureDialogTaskId,
  isTerminalState,
  onTaskDone,
  openFailureDialog,
  requestLocalConflict,
  resolveConflict,
  subscribeFsChanged,
  taskList,
} from './task-state'

/** 本窗口发起过的任务：只有它们才会自动弹出失败清单，避免多窗口重复弹窗。 */
const locallyCreatedTasks = new Set<string>()

interface PendingCreate {
  resolve: (taskId: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingCreates = new Map<string, PendingCreate>()
const CREATE_TIMEOUT_MS = 10000

async function awaitTaskAck(send: (requestId: string) => Promise<void>): Promise<string> {
  const requestId = newTaskRequestId()
  const promise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCreates.delete(requestId)
      reject(new Error('Task request timed out'))
    }, CREATE_TIMEOUT_MS)
    pendingCreates.set(requestId, { resolve, reject, timer })
  })

  try {
    await send(requestId)
  }
  catch (error) {
    const pending = pendingCreates.get(requestId)
    if (pending) {
      clearTimeout(pending.timer)
      pendingCreates.delete(requestId)
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
  return await promise
}

/**
 * 提交一个异步文件操作任务，解析出任务 id。
 *
 * **派发规则**：只要这次操作碰到浏览器挂载卷（`/@mounted/...`），就交给前端执行器
 * （`client-tasks.ts`），因为后端只认识「路径 → os.*」，解析不了那条路径——过去会
 * 把它当真实路径发过去，得到「Source path does not exist」这类必然失败的结果。
 * 其余情况仍走服务端任务。
 *
 * 两个执行器产出同一套 `TaskSnapshot`，调用方不需要区分。
 */
export async function createTask(payload: {
  kind: TaskSnapshot['kind']
  fromPaths: string[]
  toPath?: string
  onConflict?: ConflictPolicy
}): Promise<string> {
  if (needsClientExecution(payload.fromPaths, payload.toPath)) {
    const taskId = createClientTask({
      kind: payload.kind,
      fromPaths: payload.fromPaths,
      toPath: payload.toPath ?? '',
      onConflict: payload.onConflict,
    })
    locallyCreatedTasks.add(taskId)
    markLocallyCreated(taskId)
    return taskId
  }

  const taskId = await awaitTaskAck(requestId => sendCreateTask(requestId, payload))
  locallyCreatedTasks.add(taskId)
  return taskId
}

/**
 * 用失败 / 冲突的条目重试。
 *
 * 服务端任务的路径由服务端保存的结果里取（失败项上限 500），比 done 事件的 200 条
 * 上限更全；客户端任务没有服务端记录，用它自己保留的失败条目重新提交一次。
 */
export async function retryTask(taskId: string): Promise<string> {
  if (isDebugTask(taskId)) {
    throw new Error('This is a debug task: "Try Again" is not sent to the server')
  }

  if (isClientTask(taskId)) {
    const task = taskList.value.find(item => item.id === taskId)
    const fromPaths = (task?.results ?? [])
      .filter(item => item.status === 'failed' || item.status === 'conflict')
      .map(item => item.fromPath)
    if (!task || !fromPaths.length) {
      throw new Error('This task cannot be retried')
    }
    return await createTask({
      kind: task.kind,
      fromPaths,
      toPath: task.toPath,
      onConflict: 'overwrite',
    })
  }

  const newTaskId = await awaitTaskAck(requestId => sendRetryTask(requestId, taskId))
  locallyCreatedTasks.add(newTaskId)
  return newTaskId
}

/** 该任务是不是调试视图注入的假数据。 */
export function isDebugTask(taskId: string) {
  return Boolean(taskList.value.find(task => task.id === taskId)?.debug)
}

/** 该任务是不是由前端执行的挂载卷任务。 */
export function isClientTask(taskId: string) {
  return isClientTaskId(taskId)
}

/**
 * 已请求取消、但服务端还没真正停下的任务 id。
 *
 * 取消时行立刻消失（不显示「已取消」状态），而服务端要过一会儿才到终态；
 * 这段窗口里它的进度 update 不能再把行加回来，否则既会闪回，又会因为
 * `patchTask` 找不到任务而触发无谓的全量对账。
 */
const tasksPendingRemoval = new Set<string>()

/** 把任务从列表里彻底拿掉（含它占着的冲突弹窗与失败清单）。 */
function removeTaskLocally(taskId: string) {
  taskList.value = taskList.value.filter(task => task.id !== taskId)
  dropConflictRequestByTask(taskId)
  if (failureDialogTaskId.value === taskId) {
    // 任务已经没了，这里只收起弹窗，不再 dismiss 一次
    failureDialogTaskId.value = null
  }
  dropTaskDone(taskId)
}

/**
 * 取消任务并直接移除：取消是唯一控制手段，所以不保留一条「已取消」的记录。
 * 服务端任务行先本地消失，等 done 到达后再请服务端 dismiss；客户端任务没有
 * 服务端可通知，直接停掉本地执行器。
 */
export function cancelTask(taskId: string) {
  if (isDebugTask(taskId)) {
    removeTaskLocally(taskId)
    return
  }
  if (isClientTask(taskId)) {
    cancelClientTask(taskId)
    removeTaskLocally(taskId)
    return
  }
  tasksPendingRemoval.add(taskId)
  removeTaskLocally(taskId)
  return sendCancelTask(taskId).catch((error) => {
    // 没发出去（多半是连接断了）：放回来，交给重连后的全量快照对账
    tasksPendingRemoval.delete(taskId)
    console.error('[tasks] cancel failed', error)
  })
}

export function dismissTask(taskId: string) {
  if (isDebugTask(taskId)) {
    taskList.value = taskList.value.filter(task => task.id !== taskId)
    return
  }
  if (isClientTask(taskId)) {
    dismissClientTask(taskId)
    return
  }
  return sendDismissTask(taskId)
}

/**
 * 调试视图专用：把一组假任务放进列表，用来检查后台任务行的排版。
 * 它们带 debug 标记，因此不会被自动清理，取消 / 移除也不会打扰服务端。
 */
export function replaceDebugTasks(entries: (TaskSnapshot & { results?: TaskItemResult[] })[]) {
  taskList.value = [
    ...taskList.value.filter(task => !task.debug),
    ...entries.map(entry => ({ ...entry, debug: true })),
  ]
}

export function removeDebugTasks() {
  taskList.value = taskList.value.filter(task => !task.debug)
}

/** 新任务进列表。created 广播保证每个客户端都能拿到完整快照。 */
function upsertTask(snapshot: TaskSnapshot) {
  const index = taskList.value.findIndex(task => task.id === snapshot.id)
  if (index === -1) {
    taskList.value = [...taskList.value, snapshot]
    return
  }
  const next = [...taskList.value]
  next[index] = { ...next[index], ...snapshot }
  taskList.value = next
}

function patchTask(taskId: string, patch: Partial<TaskEntry>) {
  const index = taskList.value.findIndex(task => task.id === taskId)
  if (index === -1) {
    // 没有 created 就收到 patch：说明消息丢了或断线期间错过，主动重新对账
    void sendListTasks(newTaskRequestId()).catch(() => {})
    return
  }
  const next = [...taskList.value]
  next[index] = { ...next[index], ...patch }
  taskList.value = next
}

function handleDone(msg: TasksDoneMessage) {
  // 取消的任务不保留：本地立刻移除，并请服务端也删掉，
  // 任何窗口都不会看到一条「已取消」的行。
  if (msg.state === 'cancelled' || tasksPendingRemoval.has(msg.taskId)) {
    dropTaskDone(msg.taskId)
    tasksPendingRemoval.add(msg.taskId)
    removeTaskLocally(msg.taskId)
    void dismissTask(msg.taskId)?.catch(() => {})
    return
  }

  patchTask(msg.taskId, {
    state: msg.state,
    stats: msg.stats,
    error: msg.error,
    canCancel: false,
    finishedAt: Date.now(),
    results: msg.results ?? [],
    resultsTruncated: msg.resultsTruncated,
  })
  dropConflictRequestByTask(msg.taskId)

  const task = taskList.value.find(item => item.id === msg.taskId)
  if (task) {
    fireTaskDone(task, msg.results ?? [], msg.resultsTruncated)
  }

  // 只有本窗口发起、且确实有失败 / 冲突的任务才自动弹清单，
  // 避免别的窗口发起的任务在本窗口也弹一次。
  if (
    task
    && locallyCreatedTasks.has(msg.taskId)
    && (task.stats.failed > 0 || task.stats.conflict > 0)
  ) {
    openFailureDialog(msg.taskId)
  }
}

function handleTasksMessage(msg: TasksServerMessage) {
  switch (msg.type) {
    case 'response': {
      const pending = pendingCreates.get(msg.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        pendingCreates.delete(msg.requestId)
        pending.resolve(msg.taskId)
      }
      break
    }
    case 'snapshot': {
      const tasks = msg.tasks ?? []
      // 已取消的任务不显示，并顺手请服务端把它删掉（其余窗口取消 / 重连时也会走到这里）
      for (const task of tasks) {
        if (task.state === 'cancelled' && !tasksPendingRemoval.has(task.id)) {
          tasksPendingRemoval.add(task.id)
          void dismissTask(task.id)?.catch(() => {})
        }
      }
      // 客户端任务不在服务端快照里，对账不能把它们抹掉
      const clientTasks = taskList.value.filter(task => isClientTask(task.id))
      taskList.value = [
        ...tasks.filter(task => !tasksPendingRemoval.has(task.id)),
        ...clientTasks,
      ]
      // 对账：已经不在等待决策的任务，把残留的冲突弹窗丢掉
      const awaiting = new Set(
        taskList.value.filter(task => task.state === 'awaiting-conflict').map(task => task.id),
      )
      conflictQueue.value = conflictQueue.value.filter(
        item => item.source === 'local' || (item.taskId != null && awaiting.has(item.taskId)),
      )
      if (conflictQueue.value.length) {
        conflictDialogVisible.value = true
      }
      break
    }
    case 'created':
      if (!tasksPendingRemoval.has(msg.task.id)) {
        upsertTask(msg.task)
      }
      break
    case 'update':
      if (!tasksPendingRemoval.has(msg.taskId)) {
        patchTask(msg.taskId, msg.patch)
      }
      break
    case 'conflict': {
      const request: ConflictRequest = {
        id: msg.taskId,
        source: 'task',
        taskId: msg.taskId,
        destPath: msg.destPath,
        isMove: msg.isMove,
        totalCount: msg.totalCount,
        truncated: msg.truncated,
        conflicts: msg.conflicts ?? [],
      }
      conflictQueue.value = [...conflictQueue.value.filter(item => item.taskId !== msg.taskId), request]
      conflictDialogVisible.value = true
      break
    }
    case 'done':
      if (
        !tasksPendingRemoval.has(msg.taskId)
        && !taskList.value.some(task => task.id === msg.taskId)
      ) {
        // 连 done 都没有对应任务，重新拉一次全量快照
        void sendListTasks(newTaskRequestId()).catch(() => {})
      }
      handleDone(msg)
      break
    case 'removed':
      tasksPendingRemoval.delete(msg.taskId)
      removeTaskLocally(msg.taskId)
      break
    case 'error': {
      if (msg.requestId) {
        const pending = pendingCreates.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingCreates.delete(msg.requestId)
          pending.reject(new Error(msg.message))
        }
      }
      break
    }
  }
}

function handleFsMessage(msg: FsServerMessage) {
  if (msg.type !== 'changed') {
    return
  }
  emitFsChanged(msg.paths, msg.changes ?? [])
}

/* ------------------------------ 连接与对账 ------------------------------ */

subscribeSharedWsMessage((msg) => {
  if (msg.scope === 'tasks') {
    handleTasksMessage(msg as TasksServerMessage)
  }
  else if (msg.scope === 'fs') {
    handleFsMessage(msg as FsServerMessage)
  }
})

// 连接建立 / 断开重连后用全量快照对账。
// immediate 很重要：设置模块通常先连上 WS，等这个 store 初始化时状态已经是
// connected，没有 immediate 就永远不会拉初始快照，界面会看不到任何既有任务。
watch(sharedWsStatus, (status) => {
  if (status === 'connected') {
    void sendListTasks(newTaskRequestId()).catch(() => {})
  }
}, { immediate: true })

// 连接时机必须挂在**拿到 token 之后**，不能在模块求值时就连。
//
// `store/tasks.ts` 会被挂在挂载卷执行器（`client-tasks.ts`）的依赖链上，于是可能在
// 登录页的模块图里就被求值；那时 `store/auth.ts` 还没把 cookie 里的 token 读出来，
// 提前连接会得到一个必然失败的「No auth token」，而 `shared-ws` 的失败路径会顺带
// 把 token 清掉 —— 表现就是「刷新一下就被踢回登录页」。
watch(authToken, (token) => {
  if (token) {
    void ensureSharedWsConnected().catch(() => {})
  }
}, { immediate: true })

// 冲突弹窗的两个出边：取消走执行器，决策下发给服务端。
// 由这里注入，`task-state.ts` 因而不必认识任何执行器。
setTaskCanceller(taskId => void cancelTask(taskId))
setTaskDismisser(taskId => void dismissTask(taskId)?.catch(() => {}))
setConflictResolver((params) => {
  void sendResolveConflict(params)
})
