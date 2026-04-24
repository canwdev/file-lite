import type { AppParams } from '@/views/Apps/apps.ts'
import { fsWebApi } from '@/api/filesystem.ts'
import {
  regSupportedAudioFormat,
  regSupportedImageFormat,
  regSupportedVideoFormat,
} from '@/utils/is.ts'

export interface MediaFile {
  name: string
  url: string
  type: 'image' | 'video' | 'audio'
}

function getMediaType(name: string): MediaFile['type'] | null {
  if (regSupportedImageFormat.test(name))
    return 'image'
  if (regSupportedVideoFormat.test(name))
    return 'video'
  if (regSupportedAudioFormat.test(name))
    return 'audio'
  return null
}

export function useMediaList(
  getAppParams: () => AppParams | undefined,
  pruneDirectory: (basePath: string, existingNames: Set<string>) => void,
) {
  const items = ref<MediaFile[]>([])
  const currentIndex = ref(0)

  const folderName = computed(() => {
    const parts = (getAppParams()?.basePath || '').split('/').filter(Boolean)
    return parts[parts.length - 1] || '/'
  })

  watch(
    getAppParams,
    () => {
      const appParams = getAppParams()
      if (!appParams)
        return
      const { item, list, basePath } = appParams
      const result: MediaFile[] = []
      const nameSet = new Set<string>()
      for (const i of list) {
        if (i.isDirectory)
          continue
        const type = getMediaType(i.name)
        if (!type)
          continue
        result.push({ name: i.name, url: fsWebApi.getStreamUrl(`${basePath}/${i.name}`), type })
        nameSet.add(i.name)
      }
      pruneDirectory(basePath, nameSet)
      items.value = result
      const idx = result.findIndex(i => i.name === item.name)
      currentIndex.value = Math.max(0, idx)
    },
    { immediate: true },
  )

  const currentItem = computed(() => items.value[currentIndex.value] ?? null)
  const prevItem = computed(() => (currentIndex.value > 0 ? items.value[currentIndex.value - 1] : null))
  const nextItem = computed(() =>
    currentIndex.value < items.value.length - 1 ? items.value[currentIndex.value + 1] : null,
  )

  return { items, currentIndex, currentItem, prevItem, nextItem, folderName }
}
