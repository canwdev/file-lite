import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { SortType } from '@/types/server'
import { normalizeListingPath } from '../utils'

export interface PathState {
  position?: number
  sortMode?: SortType
}

/**
 * 缓存路径状态（持久化）。
 * 键为 `normalizeListingPath` 形态，与 FileManager 传入的 basePath 保持一致。
 */
export const explorerStateMap = useStorage<Record<string, PathState>>(
  LsKeys.EXPLORER_STATE_MAP,
  {},
  localStorage,
  { listenToStorageChanges: false },
)

/** 创建读写指定路径下某个状态字段的 computed ref */
export function pathStateRef<K extends keyof PathState>(
  path: Ref<string>,
  key: K,
  defaultVal: NonNullable<PathState[K]>,
) {
  return computed({
    get: () => (explorerStateMap.value[path.value]?.[key] as NonNullable<PathState[K]>) ?? defaultVal,
    set: (val: NonNullable<PathState[K]>) => {
      if (!explorerStateMap.value[path.value])
        explorerStateMap.value[path.value] = {}
      explorerStateMap.value[path.value][key] = val
    },
  })
}

/** 读取任意路径的排序方式（未设置则为 default） */
export function getPathSortMode(path: string): SortType {
  return explorerStateMap.value[normalizeListingPath(path)]?.sortMode ?? SortType.default
}
