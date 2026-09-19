/**
 * 对挂载卷做写操作时的统一守卫。
 *
 * 「只读」在挂载卷上是很正常的状态（用户只批了读、或当初就是只读挂载），所以写操作
 * 必须先问一次状态，再决定是执行、提示重新授权，还是如实报权限错误。把它收在一个
 * 地方，新建 / 重命名 / 删除 / 粘贴就不必各自重复这套判断。
 */
import { MountedFsError } from './browser-fs'
import { canWriteVolume, downgradeVolumeToReadOnly, mountedVolumes, mountIdFromPath } from './mounted-volumes'

export interface MountedWriteGuard {
  /** 该卷能不能写；不能写时 `reason` 是要展示给用户的一句话。 */
  ok: boolean
  reason?: string
  /** 写失败后调用：把卷降级为只读并提示，避免每次写都弹一次失败。 */
  onFailure: (error: unknown) => void
}

/**
 * 判断某条挂载卷路径当前能否写。
 *
 * 三种「不能写」：卷还没授权（`prompt`，需要用户点一下重新授权）、被拒（`denied`，
 * 要重新挂载）、只读（`read-only`，用户只给了读权限）。三种给不同的话术，因为出路
 * 不一样 —— 一句笼统的「权限不足」对用户没有帮助。
 */
export function mountedWriteGuard(path: string): MountedWriteGuard {
  const id = mountIdFromPath(path)
  const volume = id ? mountedVolumes.value.find(item => item.id === id) : undefined

  if (!volume) {
    return { ok: false, reason: 'This folder is no longer mounted', onFailure: () => {} }
  }

  if (canWriteVolume(volume.access)) {
    return { ok: true, onFailure: error => reportWriteFailure(volume.id, error) }
  }

  const reason = volume.access === 'read-only'
    ? `"${volume.label}" is read-only — grant write access to change it`
    : volume.access === 'prompt'
      ? `"${volume.label}" needs access again — click it in the sidebar to allow writing`
      : `Access to "${volume.label}" was denied — mount the folder again`

  return { ok: false, reason, onFailure: () => {} }
}

/** 写失败：若是权限问题就把卷降级到只读，其它原因交给调用方。 */
function reportWriteFailure(id: string, error: unknown) {
  if (error instanceof MountedFsError && error.code === 'permission') {
    downgradeVolumeToReadOnly(id)
    window.$message?.warning('This mounted folder is read-only — grant write access to change it')
    return
  }
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    downgradeVolumeToReadOnly(id)
    window.$message?.warning('This mounted folder is read-only — grant write access to change it')
  }
}

/**
 * 写操作入口：检查状态 → 执行 → 失败时按权限问题降级。
 * 返回 false 表示没有执行（状态不允许），此时已经给过提示。
 */
export async function runMountedWrite(path: string, action: () => Promise<void>): Promise<boolean> {
  const guard = mountedWriteGuard(path)
  if (!guard.ok) {
    if (guard.reason) {
      window.$message?.warning(guard.reason)
    }
    return false
  }
  try {
    await action()
    return true
  }
  catch (error) {
    guard.onFailure(error)
    throw error
  }
}
