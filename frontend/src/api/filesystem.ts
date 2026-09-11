import type { IDrive, IEntry } from '@/types/server'
import type { ServiceRequestConfig } from '@/utils/service'
import qs from 'qs'
import service from '@/utils/service'

const baseURL = `/api/files`

export const fsWebApi = {
  auth() {
    return service.get(`${baseURL}/auth`)
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
  // 上传，创建或写入文件
  uploadFile(params: { path: string, file: File }, config: ServiceRequestConfig = {}) {
    // console.log('[uploadFile]', params)
    const { path, file } = params
    const formData = new FormData()
    formData.append('file', file)

    return service.post(`${baseURL}/upload-file`, formData, {
      params: { path },
      ...config,
    })
  },
  renameEntry(params: { fromPath: string, toPath: string }) {
    return service.post(`${baseURL}/rename`, params)
  },
  copyPaste(params: { fromPaths: string[], toPath: string, isMove: boolean }) {
    return service.post(`${baseURL}/copy-paste`, params)
  },
  deleteEntry(params: { path: string[] }) {
    return service.post(`${baseURL}/delete`, params)
  },
  openInHostExplorer(params: { paths: string[] }) {
    return service.post(`${baseURL}/open-in-host-explorer`, params)
  },
  getDownloadUrl(paths: string[]) {
    if (paths.length === 1) {
      return `${baseURL}/download?path=${paths[0]}`
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
   * 后端生成的缩略图地址。`m` 只是给 HTTP 缓存/日志做标识，
   * 服务端会自己 stat 文件，不信任这个值。
   */
  getThumbnailUrl(path: string, size: number, lastModified = 0) {
    if (!path) {
      return ''
    }
    const params = new URLSearchParams({ path, size: String(size) })
    if (lastModified > 0) {
      params.set('m', String(lastModified))
    }
    return `${baseURL}/thumbnail?${params}`
  },
}

// window.$fsWebApi = fsWebApi
// console.log('window.$fsWebApi available')
