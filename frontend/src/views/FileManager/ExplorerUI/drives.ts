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

export const driveList = ref<IDrive[]>([])
export const drivesLoading = ref(false)
/**
 * 后端配置的起始目录（`startPath`）；空串表示从挂载点列表开始。
 * 由 `loadStartPath()` 拉取一次，用于首次打开标签页。
 */
export const configuredStartPath = ref('')

let inflight: Promise<IDrive[]> | null = null
let startPathInflight: Promise<string> | null = null

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
 * 读取后端配置的起始目录（只用于首次导航）。
 * 失败按「未配置」处理：起始目录不是关键路径，不该因此报错打扰用户。
 */
export function loadStartPath(): Promise<string> {
  if (startPathInflight) {
    return startPathInflight
  }
  startPathInflight = (async () => {
    try {
      configuredStartPath.value = await fsWebApi.getStartPath()
    }
    catch (error) {
      console.error('[startPath]', error)
      configuredStartPath.value = ''
    }
    finally {
      startPathInflight = null
    }
    return configuredStartPath.value
  })()
  return startPathInflight
}

/**
 * 路径所属的卷根（驱动器 / 挂载点）。
 *
 * 取「最长匹配前缀」是因为挂载点可以嵌套：`/data` 与 `/` 同时命中时，`/data/x`
 * 属于 `/data` 而不是 `/`。找不到匹配返回 null（卷未知，调用方按同卷处理）。
 */
export function resolveVolumeRoot(path: string): string | null {
  const target = normalizeListingPath(path)
  let best: string | null = null
  for (const drive of driveList.value) {
    const root = normalizeListingPath(drive.path)
    if (target === root || target.startsWith(root)) {
      if (!best || root.length > best.length) {
        best = root
      }
    }
  }
  return best
}
