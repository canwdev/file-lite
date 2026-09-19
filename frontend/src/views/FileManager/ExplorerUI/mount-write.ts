import { mountIdFromPath } from '../../../utils/fs/paths'
/**
 * 挂载卷的**写权限守卫**。
 *
 * 「只读」在挂载卷上是很正常的状态（用户只批了读、或当初就是只读挂载），所以写操作
 * 必须先问一次状态，再决定是执行、提示重新授权，还是如实报权限错误。
 *
 * 这个函数由 `mounted-volumes.ts` 注入给共享层的浏览器后端（`setMountedWriteGuard`），
 * 因此**调用点不必自己判断**——门面在写之前会问一次。这里不再提供「检查 + 执行」的
 * 包装函数：那会让同一条规则出现两个入口。
 */
import { MountedFsError } from './browser-fs'
import { canWriteVolume, downgradeVolumeToReadOnly, mountedVolumes } from './mounted-volumes'

export interface MountedWriteGuard {
  /** 该卷能不能写；不能写时 `reason` 是要展示给用户的一句话。 */
  ok: boolean
  reason?: string
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
    return { ok: false, reason: 'This folder is no longer mounted' }
  }

  if (canWriteVolume(volume.access)) {
    return { ok: true }
  }

  const reason = volume.access === 'read-only'
    ? `"${volume.label}" is read-only — grant write access to change it`
    : volume.access === 'prompt'
      ? `"${volume.label}" needs access again — click it in the sidebar to allow writing`
      : `Access to "${volume.label}" was denied — mount the folder again`

  return { ok: false, reason }
}

/** 写失败：若是权限问题就把卷降级到只读，其它原因交给调用方。 */
export function reportMountedWriteFailure(path: string, error: unknown): void {
  const id = mountIdFromPath(path)
  if (!id) {
    return
  }
  const denied = (error instanceof MountedFsError && error.code === 'permission')
    || (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError'))
  if (!denied) {
    return
  }
  // 只有在「原本以为可写」时才提示：已经从只读的卷再失败一次不值得再弹
  const volume = mountedVolumes.value.find(item => item.id === id)
  if (volume && canWriteVolume(volume.access)) {
    window.$message?.warning('This mounted folder is read-only — grant write access to change it')
  }
  downgradeVolumeToReadOnly(id)
}
