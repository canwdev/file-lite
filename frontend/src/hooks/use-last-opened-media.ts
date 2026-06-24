import type { Ref } from 'vue'
import type { IEntry } from '@/types/server'
import { LsKeys } from '@/enum'
import { useRemoteSetting } from '@/hooks/use-remote-setting'
import { settingsStore } from '@/store'
import { normalizeListingPath } from '@/views/FileManager/utils'

export type LastOpenedMediaMap = Record<string, string>

function normalizeLastOpenedMediaMap(value: unknown): LastOpenedMediaMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.entries(value).reduce<LastOpenedMediaMap>((acc, [dir, filename]) => {
    if (typeof dir === 'string' && typeof filename === 'string' && filename) {
      acc[normalizeListingPath(dir)] = filename
    }
    return acc
  }, {})
}

const { state: lastOpenedMediaMap } = useRemoteSetting<LastOpenedMediaMap>({
  key: LsKeys.LAST_OPENED_MEDIA_MAP,
  createDefaultValue: () => ({}),
  normalize: normalizeLastOpenedMediaMap,
})

export { lastOpenedMediaMap }

export function getLastOpenedMediaFilename(basePath: string): string | null {
  const filename = lastOpenedMediaMap.value[normalizeListingPath(basePath)]
  return filename || null
}

export function setLastOpenedMedia(basePath: string, filename: string): void {
  if (!settingsStore.value.rememberLastMedia) {
    return
  }
  const dir = normalizeListingPath(basePath)
  lastOpenedMediaMap.value = {
    ...lastOpenedMediaMap.value,
    [dir]: filename,
  }
}

export function clearLastOpenedMediaMap(): void {
  lastOpenedMediaMap.value = {}
}

export function clearLastOpenedMediaInDir(basePath: string): void {
  const dir = normalizeListingPath(basePath)
  if (!lastOpenedMediaMap.value[dir]) {
    return
  }
  const next = { ...lastOpenedMediaMap.value }
  delete next[dir]
  lastOpenedMediaMap.value = next
}

export function toggleRememberLastMedia(): void {
  const next = !settingsStore.value.rememberLastMedia
  settingsStore.value.rememberLastMedia = next
  if (!next) {
    clearLastOpenedMediaMap()
  }
}

export function createLastOpenedMediaRecorder() {
  let lastRecordedGuid = ''
  return (item: { guid: string, basePath: string, filename: string } | null) => {
    if (!item || !settingsStore.value.rememberLastMedia) {
      return
    }
    if (item.guid === lastRecordedGuid) {
      return
    }
    lastRecordedGuid = item.guid
    setLastOpenedMedia(item.basePath, item.filename)
  }
}

export function useLastOpenedMediaItem(
  basePath: Ref<string>,
  files: Ref<IEntry[]>,
) {
  return computed(() => {
    if (!settingsStore.value.rememberLastMedia) {
      return null
    }
    const filename = getLastOpenedMediaFilename(basePath.value)
    if (!filename) {
      return null
    }
    return files.value.find(f => f.name === filename && !f.isDirectory) ?? null
  })
}
