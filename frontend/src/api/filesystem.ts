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
  getDrives() {
    return service.get('/drives')
  },
  getList(params: any = {}) {
    const { path } = params
    return service.get('/list', {
      params: { path },
    })
  },
  createDir(params) {
    return service.post('/create-dir', params)
  },
  // 上传，创建或写入文件
  uploadFile(params, config: any = {}) {
    console.log('[uploadFile]', params)
    const { path, file } = params
    const formData = new FormData()
    formData.append('file', file)

    return service.post('/upload-file', formData, {
      params: { path },
      ...config,
    })
  },
  renameEntry(params) {
    return service.post('/rename', params)
  },
  copyPaste(params) {
    return service.post('/copy-paste', params)
  },
  deleteEntry(params) {
    return service.post('/delete', params)
  },
  getDownloadUrl(paths: string[]) {
    if (paths.length === 1) {
      return `${baseURL}/download?path=${paths[0]}&auth=${authToken.value}`
    }

    const query = qs.stringify({ paths, auth: authToken.value }, { arrayFormat: 'repeat' })
    return `${baseURL}/download?${query}`
  },
  stream(path: string, config: any = {}) {
    return service.get('/stream', {
      params: { path },
      ...config,
    })
  },
  getStreamUrl(path: string) {
    if (!path) {
      return ''
    }
    return `${baseURL}/stream?path=${encodeURIComponent(path)}&auth=${authToken.value}`
  },
}

window.$fsWebApi = fsWebApi
console.log('window.$fsWebApi available')
