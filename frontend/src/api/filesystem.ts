import type { ServerCapabilities } from '@/store/capabilities'
import type { IDrive, IEntry } from '@/types/server'
import type { ServiceRequestConfig } from '@/utils/service'
import qs from 'qs'
import service from '@/utils/service'

const baseURL = `/api/files`

/** 上传同名冲突策略，与服务端 upload-file 的 onConflict 参数一致。 */
export type UploadConflictPolicy = 'error' | 'overwrite' | 'keep-both'

/** 登录态探测的响应，同时携带后端能力开关 */
export interface IAuthInfo {
  capabilities?: Partial<ServerCapabilities>
}

export const fsWebApi = {
  async auth() {
    return (await service.get(`${baseURL}/auth`)) as unknown as IAuthInfo
  },
  login(password: string) {
    return service.post(`${baseURL}/auth`, { password }, { isAuth: false } satisfies ServiceRequestConfig) as Promise<{ token: string }>
  },
  consumeTicket(ticket: string) {
    return service.post(`${baseURL}/auth`, { ticket }, { isAuth: false } satisfies ServiceRequestConfig) as Promise<{ token: string }>
  },
  async getDrives() {
    return (await service.get(`${baseURL}/drives`)) as unknown as IDrive[]
  },
  async getList(params: any = {}, config: ServiceRequestConfig = {}) {
    const { path } = params
    return await service.get(`${baseURL}/list`, {
      params: { path },
      ...config,
    }) as unknown as IEntry[]
  },
  createDir(params: { path: string, ignoreExisted?: boolean }) {
    return service.post(`${baseURL}/create-dir`, params)
  },
  /**
   * 上传，创建或写入文件。
   * `onConflict` 决定同名时的行为：`error`（缺省，服务端返回 409）、
   * `overwrite`、`keep-both`（改名为 name (1).ext）。
   */
  uploadFile(
    params: { path: string, file: File, onConflict?: UploadConflictPolicy },
    config: ServiceRequestConfig = {},
  ) {
    const { path, file, onConflict } = params
    const formData = new FormData()
    formData.append('file', file)

    return service.post(`${baseURL}/upload-file`, formData, {
      params: { path, onConflict },
      ...config,
    })
  },
  /** 批量查询路径是否存在，用于上传前的冲突预检（文件夹上传也能覆盖到嵌套路径）。 */
  async checkExists(paths: string[]) {
    return (await service.post(`${baseURL}/exists`, { paths })) as unknown as { existing: string[] }
  },
  renameEntry(params: { fromPath: string, toPath: string }) {
    return service.post(`${baseURL}/rename`, params)
  },
  openInHostExplorer(params: { paths: string[] }) {
    return service.post(`${baseURL}/open-in-host-explorer`, params)
  },
  /**
   * 下载地址。传入的必须是**未经编码**的绝对路径，编码在这里统一做一次。
   * （曾经由调用方先 encodeURIComponent、这里再拼/再编码，导致单路径与多路径的
   * 编码次数不一致，服务端只好补一次解码，反而把文件名里的 "+" 解成了空格。）
   */
  getDownloadUrl(paths: string[]) {
    if (paths.length === 1) {
      return `${baseURL}/download?path=${encodeURIComponent(paths[0])}`
    }

    const query = qs.stringify({ paths }, { arrayFormat: 'repeat' })
    return `${baseURL}/download?${query}`
  },
  stream(path: string, config: ServiceRequestConfig = {}, noCache = true) {
    return service.get(`${baseURL}/stream`, {
      params: { path, t: noCache ? Date.now() : 0 },
      ...config,
    })
  },
  getStreamUrl(path: string) {
    if (!path) {
      return ''
    }
    return `${baseURL}/stream?path=${encodeURIComponent(path)}`
  },
  /**
   * 后端生成的缩略图地址。`kind` 区分图片来源（图片 / ffmpeg 视频封面），
   * 它参与后端的缓存键与 ETag。
   * `m` 只是给 HTTP 缓存/日志做标识，服务端会自己 stat 文件，不信任这个值。
   */
  getThumbnailUrl(path: string, size: number, lastModified = 0, kind: 'image' | 'video' = 'image') {
    if (!path) {
      return ''
    }
    const params = new URLSearchParams({ path, size: String(size) })
    if (kind !== 'image') {
      params.set('kind', kind)
    }
    if (lastModified > 0) {
      params.set('m', String(lastModified))
    }
    return `${baseURL}/thumbnail?${params}`
  },
}

// window.$fsWebApi = fsWebApi
// console.log('window.$fsWebApi available')
