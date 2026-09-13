import service from '@/utils/service'

const baseURL = `/api/update`

export interface UpdateResult {
  message: string
  from: string
  to: string
}

/**
 * 上传新的后端二进制。
 *
 * 后端会在响应发出之后才替换文件并重启，因此成功响应只代表文件已经就位；
 * 失败时后端返回 400 和具体原因，由 service 拦截器统一 toast。
 */
export function applyUpdate(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return service.post(baseURL, formData) as unknown as Promise<UpdateResult>
}

/** 退出后端进程（开发用）。响应之后进程才真正退出，之后再请求就是连接失败。 */
export function exitBackend() {
  return service.post(`${baseURL}/exit`) as unknown as Promise<{ message: string }>
}
