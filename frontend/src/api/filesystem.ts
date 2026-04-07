import type { IDrive, IEntry } from '@/types/server'
import qs from 'qs'
import { API_PROXY_BASE } from '@/enum'
import { authToken } from '@/store'
import Service from '@/utils/service'

const baseURL = `${API_PROXY_BASE}/api/files`
const service = Service({
  baseURL,
})

export const fsWebApi = {
  auth() {
    return service.get('/auth')
  },
  async getDrives() {
    return (await service.get('/drives')) as unknown as IDrive[]
  },
  async getList(params: any = {}) {
    const { path } = params
    return await service.get('/list', {
      params: { path },
    }) as unknown as IEntry[]
  },
  createDir(params: { path: string }) {
    return service.post('/create-dir', params)
  },
  // 上传，创建或写入文件
  uploadFile(params: { path: string, file: File }, config: any = {}) {
    // console.log('[uploadFile]', params)
    const { path, file } = params
    const formData = new FormData()
    formData.append('file', file)

    return service.post('/upload-file', formData, {
      params: { path },
      ...config,
    })
  },
  renameEntry(params: { fromPath: string, toPath: string }) {
    return service.post('/rename', params)
  },
  copyPaste(params: { fromPaths: string[], toPath: string, isMove: boolean }) {
    return service.post('/copy-paste', params)
  },
  deleteEntry(params: { path: string[] }) {
    return service.post('/delete', params)
  },
  getDownloadUrl(paths: string[]) {
    if (paths.length === 1) {
      return `${baseURL}/download?path=${paths[0]}`
    }

    const query = qs.stringify({ paths, auth: authToken.value }, { arrayFormat: 'repeat' })
    return `${baseURL}/download?${query}`
  },
  stream(path: string, config: any = {}, noCache = true) {
    return service.get('/stream', {
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
