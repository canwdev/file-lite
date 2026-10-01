import type { SettingsSyncMessage, SharedWsServerMessage } from '@/types/server'
import service from '@/utils/service'
import { subscribeSharedWsMessage } from './shared-ws'

/**
 * 设置键值：命令走 HTTP（docs/design/api.md §8），变更通知仍然由 WebSocket 推。
 *
 * 键可能带点（`filemanager.views`），因此按路径段整体编码。
 */
function settingsUrl(key: string) {
  return `/api/settings/${encodeURIComponent(key)}`
}

export const settingsApi = {
  /** 读取一个键；未设置时返回 null（不是错误）。 */
  async getItem(key: string) {
    const result = await service.get(settingsUrl(key), { isToast: false }) as { value: unknown }
    return result?.value ?? null
  },
  /** 写入一个键，返回服务端存下来的值。 */
  async setItem(key: string, value: unknown) {
    const result = await service.put(settingsUrl(key), { value }) as { value: unknown }
    return result?.value ?? null
  },
  /** 删除一个键。 */
  async removeItem(key: string) {
    await service.delete(settingsUrl(key), { isToast: false })
    return null
  },
  /** 订阅其它窗口的写入（本窗口的写入同样会收到，值是权威结果）。 */
  subscribe(listener: (message: SettingsSyncMessage) => void) {
    return subscribeSharedWsMessage((message: SharedWsServerMessage) => {
      if (message.scope === 'settings' && message.type === 'sync') {
        listener(message)
      }
    })
  },
}
