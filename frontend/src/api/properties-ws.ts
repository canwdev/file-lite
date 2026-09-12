import type { PropertiesClientMessage } from '@/types/server'
import { sendSharedWsMessage } from './shared-ws'

let requestSequence = 0

/** 生成请求 id，用于把异步推回的 meta / result 关联回当前窗口。 */
export function newPropertiesRequestId() {
  return `props_${Date.now()}_${requestSequence++}`
}

export async function sendPropertiesGet(requestId: string, path: string) {
  const message: PropertiesClientMessage = { scope: 'properties', type: 'get', requestId, path }
  await sendSharedWsMessage(message)
}

/** 关窗 / 换目标时通知服务端停掉仍在跑的目录统计。 */
export async function sendPropertiesCancel(requestId: string) {
  const message: PropertiesClientMessage = { scope: 'properties', type: 'cancel', requestId }
  await sendSharedWsMessage(message)
}
