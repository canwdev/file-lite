import service from '@/utils/service'

export interface PluginInfo {
  id: string
  name: string
  entryUrl: string
  iconEmoji: string
  iconUrl: string
  openWith: string[]
}

export async function listPlugins(): Promise<PluginInfo[]> {
  const result = await service.get('/api/plugins') as PluginInfo[] | null
  return Array.isArray(result) ? result : []
}
