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
}

// window.$fsWebApi = fsWebApi
// console.log('window.$fsWebApi available')
