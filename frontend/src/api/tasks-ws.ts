import type {
  ConflictPolicy,
  TaskCreatePayload,
  TasksClientMessage,
} from '@/types/server'
import { sendSharedWsMessage } from './shared-ws'

let requestSequence = 0

/** 生成一个请求 id，用于把 create 的响应关联回调用方。 */
export function newTaskRequestId() {
  return `task_${Date.now()}_${requestSequence++}`
}

export async function sendCreateTask(requestId: string, task: TaskCreatePayload) {
  const message: TasksClientMessage = { scope: 'tasks', type: 'create', requestId, task }
  await sendSharedWsMessage(message)
}

export async function sendRetryTask(requestId: string, taskId: string) {
  await sendSharedWsMessage({ scope: 'tasks', type: 'retry', requestId, taskId })
}

export async function sendCancelTask(taskId: string) {
  await sendSharedWsMessage({ scope: 'tasks', type: 'cancel', taskId })
}

export async function sendDismissTask(taskId: string) {
  await sendSharedWsMessage({ scope: 'tasks', type: 'dismiss', taskId })
}

export async function sendListTasks(requestId: string) {
  await sendSharedWsMessage({ scope: 'tasks', type: 'list', requestId })
}

export async function sendResolveConflict(params: {
  taskId: string
  policy?: ConflictPolicy
  applyToAll?: boolean
  items?: { relativePath: string, policy: ConflictPolicy }[]
}) {
  await sendSharedWsMessage({
    scope: 'tasks',
    type: 'resolve',
    taskId: params.taskId,
    policy: params.policy,
    applyToAll: params.applyToAll,
    items: params.items,
  })
}
