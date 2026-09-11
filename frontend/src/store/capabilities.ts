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
}

function createDefaultCapabilities(): ServerCapabilities {
  // 保守默认：没拿到上报之前一律当作「不支持」，避免白发请求
  return { videoThumbnail: false }
}

export const serverCapabilities = ref<ServerCapabilities>(createDefaultCapabilities())

export function setServerCapabilities(value?: Partial<ServerCapabilities> | null) {
  const next = createDefaultCapabilities()
  if (value && typeof value.videoThumbnail === 'boolean') {
    next.videoThumbnail = value.videoThumbnail
  }
  serverCapabilities.value = next
}
