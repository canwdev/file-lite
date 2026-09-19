/**
 * 驱动器（卷）列表的共享缓存。
 *
 * 侧边栏要展示它，拖拽还要用它判断「源与目标是否在同一个卷」来决定默认是移动还是复制
 * （与资源管理器一致：同卷移动、跨卷复制）。所以两边共用同一份缓存，避免各拉一次
 * `/api/drives`，也避免两份数据不一致。
 *
 * **只放后端驱动器**：浏览器挂载卷（`mounted-volumes.ts`）不进这里——后端解析不了
 * 它们的路径，混进来会让拖拽的跨卷判定选错模式。
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

/**
 * 读取驱动器列表。
 *
 * - 已有缓存且未强制刷新：直接复用。
 * - **正在请求中：无论如何都复用同一个 promise**（`force` 也不例外）。
 *
 * 最后这条是修一个真实问题：侧边栏与资源管理器面板的首次加载是同一帧发起的，
 * 而侧边栏走的是 `force = true`（用户点刷新按钮也是）。过去 `force` 会无脑再发一次，
 * 于是一次启动就有两条 `GET /api/files/drives`。
 */
export function loadDrives(force = false): Promise<IDrive[]> {
  if (inflight) {
    return inflight
  }
  if (!force && driveList.value.length) {
    return Promise.resolve(driveList.value)
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
  return cachedPathsOf(driveList.value)
}

/**
 * 归一化一份驱动器列表为挂载点路径，源数组引用不变时复用上次结果。
 *
 * 导出给 `mounted-volumes.ts` 复用：两处都需要「按源缓存」的同一件事，只是源不同。
 */
export function cachedPathsOf(source: IDrive[]): readonly string[] {
  if (source === cachedMountSource) {
    return cachedMountPaths
  }
  cachedMountSource = source
  cachedMountPaths = source.map(drive => normalizeListingPath(drive.path))
  return cachedMountPaths
}
