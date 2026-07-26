import type {
  SettingsClientMessage,
  SettingsServerMessage,
  SharedWsServerMessage,
  WsErrorMessage,
} from '@frontend/types/server.ts'
import type { WebSocket } from 'ws'
import type { SettingsStoreValue } from '@/utils/settings-store.ts'
import fs from 'node:fs'
import Path from 'node:path'
import { getFrontendStorageFilePath, internalConfig } from '@/config/config.ts'
import {
  deleteSettingsValue,
  getAllSettingsValues,
  getSettingsValue,
  reloadSettingsStore,
  setSettingsValue,

} from '@/utils/settings-store.ts'

const SETTINGS_WATCH_DEBOUNCE_MS = 200

export interface SettingsSyncClient {
  ws: WebSocket
}

interface SettingsSyncControllerOptions {
  clients: Iterable<SettingsSyncClient>
  sendJson: (ws: WebSocket, payload: SharedWsServerMessage) => void
  sendError: (ws: WebSocket, payload: WsErrorMessage) => void
}

export function createSettingsSyncController(options: SettingsSyncControllerOptions) {
  function broadcastSettings(message: SettingsServerMessage) {
    if (message.type !== 'sync') {
      return
    }
    for (const client of options.clients) {
      options.sendJson(client.ws, message)
    }
  }

  function broadcastSettingsSnapshot(previous: Record<string, unknown>, current: Record<string, unknown>) {
    const keys = new Set([
      ...Object.keys(previous),
      ...Object.keys(current),
    ])
    for (const key of keys) {
      const hasPrevious = Object.hasOwn(previous, key)
      const hasCurrent = Object.hasOwn(current, key)
      if (hasPrevious === hasCurrent && isSettingsValueEqual(previous[key], current[key])) {
        continue
      }
      broadcastSettings({
        scope: 'settings',
        type: 'sync',
        key,
        value: hasCurrent ? current[key] as SettingsStoreValue : null,
      })
    }
  }

  async function reloadSharedWsSettings() {
    const { previous, current } = await reloadSettingsStore()
    broadcastSettingsSnapshot(previous, current)
  }

  function attachFrontendStorageWatcher() {
    if (!internalConfig.configInitialized) {
      return () => {}
    }

    const filePath = getFrontendStorageFilePath()
    const dir = Path.dirname(filePath)
    const filename = Path.basename(filePath)
    let timer: NodeJS.Timeout | null = null
    let isReloading = false
    let hasPendingReload = false

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    async function reloadSettingsFromFile() {
      if (isReloading) {
        hasPendingReload = true
        return
      }

      isReloading = true
      try {
        do {
          hasPendingReload = false
          await reloadSharedWsSettings()
        } while (hasPendingReload)
      }
      catch (error) {
        console.error('Failed to reload frontend settings store', error)
      }
      finally {
        isReloading = false
      }
    }

    function scheduleReload() {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        void reloadSettingsFromFile()
      }, SETTINGS_WATCH_DEBOUNCE_MS)
    }

    const watcher = fs.watch(dir, (event, changedFilename) => {
      if (event !== 'change' && event !== 'rename') {
        return
      }
      const changed = changedFilename?.toString()
      if (changed && changed !== filename) {
        return
      }
      scheduleReload()
    })

    watcher.on('error', (error) => {
      console.error('Failed to watch frontend settings store', error)
    })

    return () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      watcher.close()
    }
  }

  async function syncSettingsToClient(client: SettingsSyncClient) {
    const store = await getAllSettingsValues()
    for (const [key, value] of Object.entries(store)) {
      options.sendJson(client.ws, {
        scope: 'settings',
        type: 'sync',
        key,
        value,
      })
    }
  }

  async function handleSettingsMessage(client: SettingsSyncClient, payload: SettingsClientMessage) {
    try {
      if (payload.type === 'get') {
        const value = await getSettingsValue(payload.key)
        options.sendJson(client.ws, {
          scope: 'settings',
          type: 'response',
          requestId: payload.requestId,
          action: 'get',
          key: payload.key,
          value,
        })
        return
      }
      if (payload.type === 'set') {
        const value = await setSettingsValue(payload.key, payload.value as SettingsStoreValue)
        const response: SettingsServerMessage = {
          scope: 'settings',
          type: 'response',
          requestId: payload.requestId,
          action: 'set',
          key: payload.key,
          value,
        }
        options.sendJson(client.ws, response)
        broadcastSettings({
          scope: 'settings',
          type: 'sync',
          key: payload.key,
          value,
        })
        return
      }

      const value = await deleteSettingsValue(payload.key)
      options.sendJson(client.ws, {
        scope: 'settings',
        type: 'response',
        requestId: payload.requestId,
        action: 'delete',
        key: payload.key,
        value,
      })
      broadcastSettings({
        scope: 'settings',
        type: 'sync',
        key: payload.key,
        value,
      })
    }
    catch (error: any) {
      options.sendError(client.ws, {
        scope: 'settings',
        type: 'error',
        message: error?.message || 'Settings request failed',
        requestId: payload.requestId,
      })
    }
  }

  return {
    attachFrontendStorageWatcher,
    handleSettingsMessage,
    syncSettingsToClient,
  }
}

function isSettingsValueEqual(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  catch {
    return false
  }
}
