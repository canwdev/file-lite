import { API_PROXY_BASE } from '@/enum'
import service from '@/utils/service'

const baseURL = `${API_PROXY_BASE}/api/settings`

export const settingsApi = {
  async getItem(key: string) {
    const data = await service.get(`${baseURL}/${encodeURIComponent(key)}`) as { value: unknown }
    return data.value
  },
  async setItem(key: string, value: unknown) {
    await service.put(`${baseURL}/${encodeURIComponent(key)}`, { value })
  },
  async removeItem(key: string) {
    await service.delete(`${baseURL}/${encodeURIComponent(key)}`)
  },
}
