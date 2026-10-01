import service from '@/utils/service'

/** 自更新、重启与退出（docs/design/api.md §10）。只有服务端开了 allowSelfUpdate 才存在。 */

export interface UpdateResult {
  message: string
  from: string
  to: string
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
