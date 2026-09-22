import service from '@/utils/service'

export interface PluginInfo {
  id: string
  name: string
  entryUrl: string
  iconEmoji: string
  iconUrl: string
  openWith: string[]
}

let cached: PluginInfo[] | null = null
let pending: Promise<PluginInfo[]> | null = null

function fetchPlugins(): Promise<PluginInfo[]> {
  return service.get('/api/plugins').then((result) => {
    return Array.isArray(result) ? result as PluginInfo[] : []
  })
}

/** 页面加载后的那一次结果。已经有了就不再请求。 */
export function listPlugins(): Promise<PluginInfo[]> {
  if (cached !== null)
    return Promise.resolve(cached)
  if (!pending) {
    pending = fetchPlugins().then((list) => {
      cached = list
      pending = null
      return list
    }).catch((error) => {
      cached = []
      pending = null
      throw error
    })
  }
  return pending
}

/** Plugins 子菜单的 Refresh。失败时保留上一份列表。 */
export function refreshPlugins(): Promise<PluginInfo[]> {
  return fetchPlugins().then((list) => {
    cached = list
    return list
  })
}
