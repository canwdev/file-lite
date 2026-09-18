/**
 * 驱动器（卷）列表的共享缓存。
 *
 * 侧边栏要展示它，拖拽还要用它判断「源与目标是否在同一个卷」来决定默认是移动还是复制
 * （与资源管理器一致：同卷移动、跨卷复制）。所以两边共用同一份缓存，避免各拉一次
 *  `/api/drives`，也避免两份数据不一致。
 */
import type { IDrive } from '@/types/server'
import { ref } from 'vue'
import { fsWebApi } from '@/api/filesystem'
import { normalizeListingPath } from '../utils'
import { findMountRoot } from '../utils/volume-mounts'

export const driveList = ref<IDrive[]>([])
export const drivesLoading = ref(false)

let inflight: Promise<IDrive[]> | null = null

/** 已加载的驱动器路径（listing 形态，带结尾 `/`），从长到短，便于取最长前缀。 */
function normalizeDrives(list: IDrive[] | null | undefined): IDrive[] {
  return (list ?? []).map(item => ({ ...item, path: normalizeListingPath(item.path) }))
}

/** 读取驱动器列表；已有缓存且未强制刷新时直接复用。 */
export function loadDrives(force = false): Promise<IDrive[]> {
  if (!force && driveList.value.length) {
    return Promise.resolve(driveList.value)
  }
  if (!force && inflight) {
    return inflight
  }

  drivesLoading.value = true
  inflight = (async () => {
    try {
      driveList.value = normalizeDrives(await fsWebApi.getDrives())
    }
    catch (error) {
      console.error('[drives]', error)
      driveList.value = []
    }
    finally {
      drivesLoading.value = false
      inflight = null
    }
    return driveList.value
  })()
  return inflight
}

/**
 * 路径所属的卷根（驱动器 / 挂载点）。
 *
 * 取「最长匹配前缀」是因为挂载点可以嵌套：`/data` 与 `/` 同时命中时，`/data/x`
 * 属于 `/data` 而不是 `/`。匹配必须是**段边界**：裸 `startsWith` 会把 `/data2/x`
 * 判成属于 `/data`，于是跨卷判断错了，拖拽会把跨卷复制做成同卷移动。
 *
 * 找不到匹配返回 null（卷未知，调用方按同卷处理）。
 */
export function resolveVolumeRoot(path: string): string | null {
  return findMountRoot(path, mountPaths())
}

/**
 * 当前挂载点路径（listing 形态）。
 *
 * 供 `utils/index.ts` 的挂载感知导航（canGoUp / getParentPath / 面包屑）读取。
 * 这里做一次归一化并缓存，避免每次按键都重新算一遍整张表。
 */
let cachedMountPaths: string[] = []
let cachedMountSource: IDrive[] = []

export function mountPaths(): readonly string[] {
  const list = driveList.value
  if (list === cachedMountSource) {
    return cachedMountPaths
  }
  cachedMountSource = list
  cachedMountPaths = list.map(drive => normalizeListingPath(drive.path))
  return cachedMountPaths
}
