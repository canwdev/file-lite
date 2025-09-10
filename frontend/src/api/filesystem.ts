import Service from '@/utils/service'
import {API_PROXY_BASE} from '@/enum'

const service = Service({
  baseURL: API_PROXY_BASE + '/api/files',
})

export const fsWebApi = {
  getDrives() {
    return service.get('/drives')
  },
  getList(params: any = {}) {
    const {path} = params
    return service.post('/list', {
      path,
    })
  },
  getStream(params) {
    return service.get('/stream', {params})
  },
  createDir(params) {
    return service.post('/create-dir', params)
  },
  // 上传，创建或写入文件
  uploadFile(params, config: any = {}) {
    console.log('[uploadFile]', params)
    const {path, file} = params
    const formData = new FormData()
    formData.append('file', file)

    return service.post('/upload-file', formData, {
      params: {path},
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
  downloadEntry(params) {
    return service.get('/download', {params})
  },
  createShareLink(params) {
    return service.post('/create-share-link', params)
  },
}
