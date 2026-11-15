import type { UpdateStatus } from '@/types/server'
import service from '@/utils/service'

/** 更新、重启与退出（docs/design/api.md §10）。重启和退出只在服务端开了 allowSelfUpdate 时存在。 */

export interface UpdateResult {
  message: string
  from: string
  to: string
}

export type UpdateChannel = 'stable' | 'preview'

export interface UpdateAsset {
  name: string
  size: number
  digest?: string
}

/** `GET /api/server/update` 的结果：当前构建与渠道里最新版本的对比。 */
export interface UpdateInfo {
  current: string
  latest: string
  available: boolean
  tag: string
  notesUrl: string
  publishedAt?: string
  prerelease: boolean
  asset: UpdateAsset
}

/**
 * 上传新的后端二进制（请求体就是二进制本身，不是 multipart）。
 *
 * 后端会在响应发出之后才替换文件并重启，因此成功响应只代表文件已经就位；
 * 失败时后端返回 400 和具体原因，由 service 拦截器统一 toast。
 */
export function applyUpdate(file: File) {
  return service.post(`/api/server/updates`, file) as unknown as Promise<UpdateResult>
}

/**
 * 重启后端进程（开发用），用来重载配置。
 *
 * 后端会在响应发出之后才重启，所以 202 只代表请求已经受理：接下来一小段时间
 * 服务是连不上的，等它回来再刷新页面。
 */
export function restartBackend() {
  return service.post(`/api/server/restarts`) as unknown as Promise<{ message: string }>
}

/** 退出后端进程（开发用）。响应之后进程才真正退出，之后再请求就是连接失败。 */
export function exitBackend() {
  return service.delete(`/api/server`) as unknown as Promise<{ message: string }>
}

/**
 * Ask the backend whether the selected channel has a newer release.
 *
 * The backend resolves the release for its own platform, so the browser never
 * needs to know which asset to pick. A failed GitHub request becomes a 502.
 */
export async function checkUpdate(channel: UpdateChannel, options?: { isToast?: boolean }): Promise<UpdateInfo> {
  return (await service.get(`/api/server/update`, { params: { channel }, isToast: options?.isToast })) as unknown as UpdateInfo
}

/** Snapshot of an update that is already downloading, fetched when the app opens. */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  return (await service.get(`/api/server/update/status`, { isToast: false })) as unknown as UpdateStatus
}

/**
 * Download, verify and install the release with the given tag.
 *
 * Progress arrives over the shared WebSocket (`scope: 'update'`). The backend
 * answers only after the binary has been replaced, then restarts itself.
 */
export async function installGitHubUpdate(tag: string, options?: { isToast?: boolean }): Promise<UpdateResult> {
  return (await service.post(`/api/server/updates/github`, { tag }, { isToast: options?.isToast })) as unknown as UpdateResult
}
