import type { SortField } from '../utils/sort'
import type { PathState } from './path-state'
import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { SortType } from '@/types/server'
import { normalizeListingPath } from '../utils'
import { mountPaths } from './drives'
import { resolveInheritedPathState } from './path-state'

export type { PathState }

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

/** 只写某个目录**自己**的状态，不碰继承链 */
function writeOwnPathState<K extends keyof PathState>(path: string, key: K, val: NonNullable<PathState[K]>) {
  const entry = normalizeListingPath(path)
  if (!explorerStateMap.value[entry])
    explorerStateMap.value[entry] = {}
  explorerStateMap.value[entry][key] = val
}

/**
 * 有效排序：目录自己的手动设置 > 最近一个手动设置过的祖先 > 默认。
 *
 * 「默认」目前是名字升序（见 `parseSortMode`）。若要按目录名给更聪明的默认
 * （例如 Download → 最近修改倒序），在这里兜底即可。
 */
export function getPathSortMode(path: string): SortType {
  return resolveInheritedPathState(explorerStateMap.value, path, 'sortMode', mountPaths()) ?? SortType.default
}

/** 有效分组字段，继承规则同排序；都没有则为 `none` */
export function getPathGroupField(path: string): SortField | 'none' {
  return resolveInheritedPathState(explorerStateMap.value, path, 'groupField', mountPaths()) ?? 'none'
}

/** 有效分组方向，继承规则同排序；都没有则为升序 */
export function getPathGroupDesc(path: string): boolean {
  return resolveInheritedPathState(explorerStateMap.value, path, 'groupDesc', mountPaths()) ?? false
}

/** 排序 ref：读走继承解析，写落在当前目录自己的记录上 */
export function sortModeRef(path: Ref<string>) {
  return computed({
    get: () => getPathSortMode(path.value),
    set: (val: SortType) => writeOwnPathState(path.value, 'sortMode', val),
  })
}

/** 分组字段 ref，读写语义同 `sortModeRef` */
export function groupFieldRef(path: Ref<string>) {
  return computed({
    get: () => getPathGroupField(path.value),
    set: (val: SortField | 'none') => writeOwnPathState(path.value, 'groupField', val),
  })
}

/** 分组方向 ref，读写语义同 `sortModeRef` */
export function groupDescRef(path: Ref<string>) {
  return computed({
    get: () => getPathGroupDesc(path.value),
    set: (val: boolean) => writeOwnPathState(path.value, 'groupDesc', val),
  })
}
