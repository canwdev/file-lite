import service from '@/utils/service'

export interface PluginInfo {
  id: string
  name: string
  entryUrl: string
  iconEmoji: string
  iconUrl: string
  openWith: string[]
  singleInstance: boolean
  version: string
}

/** 页面上已有的插件列表。打开方式和网格角标读它，随请求更新。 */
export const pluginList = shallowRef<PluginInfo[]>([])

let cached: PluginInfo[] | null = null
let pending: Promise<PluginInfo[]> | null = null

function fetchPlugins(): Promise<PluginInfo[]> {
  return service.get('/api/plugins').then((result) => {
    return Array.isArray(result) ? result as PluginInfo[] : []
  })
}

function storePlugins(list: PluginInfo[]) {
  cached = list
  pluginList.value = list
  return list
}

/** 页面加载后的那一次结果。已经有了就不再请求。 */
export function listPlugins(): Promise<PluginInfo[]> {
  if (cached !== null)
    return Promise.resolve(cached)
  if (!pending) {
    pending = fetchPlugins().then((list) => {
      pending = null
      return storePlugins(list)
    }).catch((error) => {
      pending = null
      storePlugins([])
      throw error
    })
  }
  return pending
}

/** Plugins 子菜单的 Refresh。失败时保留上一份列表。 */
export function refreshPlugins(): Promise<PluginInfo[]> {
  return fetchPlugins().then(list => storePlugins(list))
}
