/**
 * 任务列表的共享状态与完成回调登记。
 *
 * 单独成模块，让任务列表与完成回调不依赖 WebSocket 传输层（`store/tasks.ts`）：
 * 上传冲突弹窗这类本地调用方也能直接用它，不必把整套 WS 依赖拉进来。
 */
import type { ConflictPolicy, FsDirChange, TaskItemResult, TaskSnapshot, TaskState } from '@/types/server'
import { ref } from 'vue'

/** 任务终态判定，与服务端保持一致。 */
export function isTerminalState(state: TaskState) {
  return state === 'succeeded' || state === 'partial' || state === 'failed' || state === 'cancelled'
}

/** 任务快照 + 最近一次 done 带来的逐条结果（用于失败清单）。 */
export interface TaskEntry extends TaskSnapshot {
  results?: TaskItemResult[]
  resultsTruncated?: boolean
  /** 调试视图注入的假任务：不来自服务端，取消 / 移除只在本地生效。 */
  debug?: boolean
}

/** 任务列表。 */
export const taskList = ref<TaskEntry[]>([])

/** 任务完成回调：用于在任务结束后处理剪贴板等调用方状态。 */
export type DoneHandler = (task: TaskSnapshot, results: TaskItemResult[], resultsTruncated: boolean) => void

const doneHandlers = new Map<string, DoneHandler>()

export function onTaskDone(taskId: string, handler: DoneHandler) {
  doneHandlers.set(taskId, handler)
}

/**
 * 触发一个任务的完成回调并注销它。
 *
 * 服务端任务的 done 消息到达时由 `store/tasks.ts` 调用。
 */
export function fireTaskDone(task: TaskSnapshot, results: TaskItemResult[], resultsTruncated: boolean) {
  const handler = doneHandlers.get(task.id)
  if (handler) {
    doneHandlers.delete(task.id)
    handler(task, results, resultsTruncated)
  }
}

/** 关键路径上没人接手的回调不该永远留着 */
export function dropTaskDone(taskId: string) {
  doneHandlers.delete(taskId)
}

/* ------------------------------ 冲突决策 ------------------------------ */

export interface ConflictResolution {
  policy: ConflictPolicy
  applyToAll: boolean
  items: { relativePath: string, policy: ConflictPolicy }[]
}

/**
 * 一次待决策的冲突。既可能来自服务端任务（copy / move），
 * 也可能来自本地上传——两者共用同一个弹窗。
 */
export interface ConflictRequest {
  /** 任务请求用任务 id，本地请求用生成的 id。 */
  id: string
  source: 'task' | 'local'
  taskId?: string
  destPath: string
  isMove: boolean
  totalCount: number
  truncated: boolean
  conflicts: import('@/types/server').TaskConflictItem[]
  /** 弹窗副标题用的动作名，例如 Upload / Copy / Move。 */
  action?: string
  /** 仅本地请求：决策回调用它把结果交回调用方。 */
  resolveLocal?: (resolution: ConflictResolution | null) => void
}

export const conflictQueue = ref<ConflictRequest[]>([])
export const conflictDialogVisible = ref(false)

/**
 * 取消任务的动作。由 `store/tasks.ts` 注入。
 *
 * 冲突弹窗点 Cancel 要取消任务，但取消是执行器的事（服务端任务发 WS、客户端任务
 * 停本地）。注入让本模块保持「状态 + 决策」的职责，不必认识任何一个执行器。
 */
let taskCanceller: ((taskId: string) => void) | null = null

export function setTaskCanceller(canceller: (taskId: string) => void) {
  taskCanceller = canceller
}

/** 服务端任务冲突决策的下发动作（由 `store/tasks.ts` 注入）。 */
let conflictResolver: ((params: {
  taskId: string
  policy: ConflictPolicy
  applyToAll: boolean
  items: { relativePath: string, policy: ConflictPolicy }[]
}) => void) | null = null

export function setConflictResolver(resolver: typeof conflictResolver) {
  conflictResolver = resolver
}

let localConflictSequence = 0

/**
 * 请求一次本地冲突决策（上传前的同名冲突用）。
 * 解析为决策结果；用户取消时解析为 null（调用方应放弃这次操作）。
 */
export function requestLocalConflict(
  params: Omit<ConflictRequest, 'id' | 'source' | 'resolveLocal'>,
): Promise<ConflictResolution | null> {
  return new Promise((resolve) => {
    const request: ConflictRequest = {
      ...params,
      id: `local_${Date.now()}_${localConflictSequence++}`,
      source: 'local',
      resolveLocal: resolve,
    }
    conflictQueue.value = [...conflictQueue.value, request]
    conflictDialogVisible.value = true
  })
}

/** 提交冲突决策。resolution 为 null 表示取消这次操作。 */
export function resolveConflict(id: string, resolution: ConflictResolution | null) {
  const request = conflictQueue.value.find(item => item.id === id)
  if (!request) {
    return
  }
  dropConflictRequest(id)
  if (request.source === 'local') {
    request.resolveLocal?.(resolution)
    return
  }
  if (!request.taskId) {
    return
  }
  if (!resolution) {
    // Cancel 不是「先放着」：直接取消任务并移除，列表里不留等待决策的残局
    taskCanceller?.(request.taskId)
    return
  }
  conflictResolver?.({
    taskId: request.taskId,
    policy: resolution.policy,
    applyToAll: resolution.applyToAll,
    items: resolution.items,
  })
}

function dropConflictRequest(id: string) {
  conflictQueue.value = conflictQueue.value.filter(item => item.id !== id)
  if (!conflictQueue.value.length) {
    conflictDialogVisible.value = false
  }
}

/** 任务结束时把它占着的冲突弹窗收掉（客户端任务没有 WS，需要主动调）。 */
export function dropConflictRequestByTask(taskId: string) {
  conflictQueue.value = conflictQueue.value.filter(item => item.taskId !== taskId)
  if (!conflictQueue.value.length) {
    conflictDialogVisible.value = false
  }
}

/* ------------------------------ 失败清单 ------------------------------ */

/** 失败清单弹窗当前展示的任务。 */
export const failureDialogTaskId = ref<string | null>(null)

export function openFailureDialog(taskId: string) {
  failureDialogTaskId.value = taskId
}

/**
 * 关闭失败清单，并丢弃这条失败记录。
 *
 * 失败清单是这条记录最后的用途：看过了（或重试了）就不该在任务列表里继续
 * 留一条失败行，否则只会越积越多。取消 / 任务移除走的 `removeTaskLocally`
 * 不经过这里，因此不会多送一次 dismiss。
 */
export function closeFailureDialog() {
  const taskId = failureDialogTaskId.value
  failureDialogTaskId.value = null
  if (taskId) {
    taskDismisser?.(taskId)
  }
}

/**
 * 丢弃一条任务记录的动作。由 `store/tasks.ts` 注入——客户端任务没有服务端可通知，
 * 服务端任务要发 dismiss，两者的差别只在这里。
 */
let taskDismisser: ((taskId: string) => void) | null = null

export function setTaskDismisser(dismisser: (taskId: string) => void) {
  taskDismisser = dismisser
}

/** 某个任务里失败 / 冲突的条目（受服务端 200 条上限约束，Try Again 不受约束）。 */
export function failedItemsOf(taskId: string): TaskItemResult[] {
  const entry = taskList.value.find(item => item.id === taskId)
  if (!entry?.results) {
    return []
  }
  return entry.results.filter(item => item.status === 'failed' || item.status === 'conflict')
}

/* ------------------------------ 目录变化 ------------------------------ */

export type FsChangedListener = (paths: string[], changes: FsDirChange[]) => void

const fsChangedListeners = new Set<FsChangedListener>()

/** 订阅目录变化。返回取消订阅函数。 */
export function subscribeFsChanged(listener: FsChangedListener) {
  fsChangedListeners.add(listener)
  return () => {
    fsChangedListeners.delete(listener)
  }
}

export function emitFsChanged(paths: string[], changes: FsDirChange[]) {
  for (const listener of fsChangedListeners) {
    listener(paths, changes)
  }
}
