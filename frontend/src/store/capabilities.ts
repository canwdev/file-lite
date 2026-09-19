/**
 * 后端能力开关（server capabilities）。
 *
 * 由 `/api/files/auth` 在登录校验时一次性上报。有这个开关，前端才不会去请求
 * 这台机器根本不支持的东西 —— 典型是没有 ffmpeg 时，网格里每个视频都会发一次
 * 注定失败的封面请求，而且分不清「服务器没有这个能力」和「这个文件解不出来」。
 */
export interface ServerCapabilities {
  /** 后端能用 ffmpeg 抽帧生成视频封面 */
  videoThumbnail: boolean
  /** 后端允许替换自身二进制 / 重启 / 退出进程（config 里的 allowSelfUpdate） */
  selfUpdate: boolean
}

function createDefaultCapabilities(): ServerCapabilities {
  // 保守默认：没拿到上报之前一律当作「不支持」，避免白发请求
  return { videoThumbnail: false, selfUpdate: false }
}

export const serverCapabilities = ref<ServerCapabilities>(createDefaultCapabilities())

/**
 * 服务端配置的文件访问范围（`safeBaseDirs`），空数组表示不限制。
 *
 * 与能力开关同一份上报、同一个时机。它不影响功能开关，所以不并进
 * `ServerCapabilities`：那不是「能力」，而是这次部署的一个约束。
 */
export const serverBaseDirs = ref<string[]>([])

export function setServerBaseDirs(value?: string[] | null) {
  serverBaseDirs.value = Array.isArray(value) ? value.filter(p => typeof p === 'string' && p !== '') : []
}

export function setServerCapabilities(value?: Partial<ServerCapabilities> | null) {
  const next = createDefaultCapabilities()
  if (value && typeof value.videoThumbnail === 'boolean') {
    next.videoThumbnail = value.videoThumbnail
  }
  if (value && typeof value.selfUpdate === 'boolean') {
    next.selfUpdate = value.selfUpdate
  }
  serverCapabilities.value = next
}
