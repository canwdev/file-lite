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

/**
 * 会话内的全量缓存。
 *
 * 一个窗口要读好几个键（收藏、上次播放、默认应用、每目录视图设置…），逐键请求会让
 * 启动凭空多出 N 次往返，而这些键的总量很小。所以第一次读就走一次
 * `GET /api/settings` 把全部取回来，之后按键命中缓存；写入与其它窗口的 sync 推送
 * 都会更新它。
 */
const cache = new Map<string, unknown>()
/** 是否已经拿到过完整快照：拿到之后，「不在缓存里」就等于「服务端没有这个键」。 */
let allLoaded = false
let loading: Promise<void> | null = null

/** 拉一次全量快照；并发调用共用同一个请求。 */
async function loadAll(): Promise<void> {
  if (allLoaded) {
    return
  }
  if (!loading) {
    loading = (async () => {
      const store = await service.get('/api/settings', { isToast: false }) as unknown as Record<string, unknown>
      if (store && typeof store === 'object') {
        for (const [key, value] of Object.entries(store)) {
          cache.set(key, value)
        }
      }
      allLoaded = true
    })().finally(() => {
      // 失败时 allLoaded 仍为 false，下一次读取会重试
      loading = null
    })
  }
  await loading
}

/** 丢弃缓存：登出时调用，免得下一个会话读到上一个人的设置。 */
export function resetSettingsCache() {
  cache.clear()
  allLoaded = false
  loading = null
}

/**
 * 读出/写入缓存时都复制一份。
 *
 * 缓存里的对象与各处的 ref 共享引用的话，组件在原地改数组（收藏的 toggle）会先改到
 * 缓存身上，写入失败时缓存与服务端就对不上了。设置项都很小，复制比共享划算。
 */
function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T
  }
  catch {
    return value
  }
}

// 其它窗口的写入（以及连接时服务端推的全量快照）都会以 sync 到达：顺手进缓存。
subscribeSharedWsMessage((message: SharedWsServerMessage) => {
  if (message.scope === 'settings' && message.type === 'sync') {
    cache.set(message.key, message.value)
  }
})

export const settingsApi = {
  /** 读取一个键；未设置时返回 null（不是错误）。 */
  async getItem(key: string) {
    if (!cache.has(key)) {
      await loadAll()
    }
    return cloneValue(cache.get(key) ?? null)
  },
  /** 写入一个键，返回服务端存下来的值。 */
  async setItem(key: string, value: unknown) {
    const result = await service.put(settingsUrl(key), { value }) as { value: unknown }
    const stored = result?.value ?? value
    cache.set(key, cloneValue(stored))
    return stored
  },
  /** 删除一个键。 */
  async removeItem(key: string) {
    await service.delete(settingsUrl(key), { isToast: false })
    cache.delete(key)
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
