import type { ConflictPolicy, TaskCreatePayload, TaskSnapshot } from '@/types/server'
import service from '@/utils/service'

/**
 * 任务命令走 HTTP（docs/design/api.md §7）；进度、冲突与结果仍然由 WebSocket 推。
 *
 * 所有调用都用 `isToast: false`：调用方自己捕获并展示失败原因（与旧的 WS 命令一致），
 * 交给拦截器统一 toast 会出现两遍。为此这里把服务端的 message 重新包成 Error，
 * 调用方显示的就是后端那句话，而不是 axios 的 "Request failed with status code 400"。
 */
function taskError(error: unknown): Error {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
  if (message) {
    return new Error(message)
  }
  return error instanceof Error ? error : new Error('Task request failed')
}

/** 创建一个任务，返回它的快照（含 id）。 */
export async function createTask(payload: TaskCreatePayload): Promise<TaskSnapshot> {
  try {
    return (await service.post('/api/tasks', payload, { isToast: false })) as unknown as TaskSnapshot
  }
  catch (error) {
    throw taskError(error)
  }
}

/** 全部任务快照，用于断线重连后的对账。 */
export async function listTasks(): Promise<TaskSnapshot[]> {
  try {
    const result = await service.get('/api/tasks', { isToast: false })
    return Array.isArray(result) ? (result as TaskSnapshot[]) : []
  }
  catch (error) {
    throw taskError(error)
  }
}

/**
 * 用失败 / 冲突的条目重试，返回新任务的快照。
 *
 * 失败项的路径由服务端保存的结果里取（失败项上限 500），比 done 事件的 200 条上限更全。
 */
export async function retryTask(taskId: string): Promise<TaskSnapshot> {
  try {
    return (await service.post(`/api/tasks/${encodeURIComponent(taskId)}/retries`, undefined, { isToast: false })) as unknown as TaskSnapshot
  }
  catch (error) {
    throw taskError(error)
  }
}

/** 取消运行中的任务，或把已结束的任务移出列表。 */
export async function deleteTask(taskId: string): Promise<void> {
  try {
    await service.delete(`/api/tasks/${encodeURIComponent(taskId)}`, { isToast: false })
  }
  catch (error) {
    throw taskError(error)
  }
}

/** 回答一次冲突，让任务继续。 */
export async function resolveTask(params: {
  taskId: string
  policy?: ConflictPolicy
  applyToAll?: boolean
  items?: { relativePath: string, policy: ConflictPolicy }[]
}): Promise<void> {
  try {
    await service.post(`/api/tasks/${encodeURIComponent(params.taskId)}/resolutions`, {
      policy: params.policy,
      applyToAll: params.applyToAll,
      items: params.items,
    }, { isToast: false })
  }
  catch (error) {
    throw taskError(error)
  }
}
