import type { SettingsResponseMessage, SettingsSyncMessage, SharedWsServerMessage } from '@/types/server'
import { requestSharedWs, subscribeSharedWsMessage } from './shared-ws'

export const settingsApi = {
  async getItem(key: string) {
    const message = await requestSharedWs<SettingsResponseMessage>({
      scope: 'settings',
      type: 'get',
      key,
    })
    return message.value
  },
  async setItem(key: string, value: unknown) {
    const message = await requestSharedWs<SettingsResponseMessage>({
      scope: 'settings',
      type: 'set',
      key,
      value,
    })
    return message.value
  },
  async removeItem(key: string) {
    const message = await requestSharedWs<SettingsResponseMessage>({
      scope: 'settings',
      type: 'delete',
      key,
    })
    return message.value
  },
  subscribe(listener: (message: SettingsSyncMessage) => void) {
    return subscribeSharedWsMessage((message: SharedWsServerMessage) => {
      if (message.scope === 'settings' && message.type === 'sync') {
        listener(message)
      }
    })
  },
}
