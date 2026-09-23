import type { SortField } from '../utils/sort'
import type { SortType } from '@/types/server'
import { normalizeListingPath, normalizePath } from '../../../utils/path/form'
import { boundaryFor, listingParent } from '../utils/volume-mounts'

/** 每个目录自己的界面状态；排序 / 分组支持向祖先继承，位置与折叠组只属于自己。 */
export interface PathState {
  position?: number
  sortMode?: SortType
  groupField?: SortField | 'none'
  groupDesc?: boolean
  collapsedGroups?: string[]
}

/**
 * 沿祖先解析某个状态字段：`path` 自身 → 最近一个手动设置过的祖先 → 未设置。
 *
 * - 只在挂载点根以内向上找，不跨卷继承；
 * - 挂载边界只算一次，之后纯字符串剥段，单次解析是 O(目录深度)；
 * - `state` / `mounts` 都由调用方传入，纯函数，便于在没有 Vue 的情况下测试。
 */
export function resolveInheritedPathState<K extends keyof PathState>(
  state: Record<string, PathState>,
  path: string,
  key: K,
  mounts: readonly string[],
): PathState[K] | undefined {
  let current = normalizeListingPath(path)
  if (!current) {
    return undefined
  }
  const boundary = boundaryFor(normalizePath(current), mounts)
  for (;;) {
    const own = state[current]?.[key]
    if (own !== undefined) {
      return own
    }
    if (current === boundary) {
      return undefined
    }
    const parent = listingParent(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}
