import type { FsBackend, FsWriteOptions } from './backend'
/**
 * 服务端后端：`/api/files/*`。
 *
 * 它是 `FsBackend` 的默认实现。注意「删除」在这里**故意不实现**：服务端的删除是
 * 一个可取消的后台任务（有进度、冲突、失败清单），不属于字节层。调用方要走
 * `createTask({ kind: 'delete' })`，由任务层决定派给谁。
 */
import type { IEntry } from '@/types/server'
import { fsWebApi } from '@/api/filesystem'
import { generateTextFile, normalizePath } from '@/views/FileManager/utils'

function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  return cut > 0 ? trimmed.slice(0, cut) : trimmed
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

export const serverBackend: FsBackend = {
  async canWrite() {
    // 服务端没有「只读卷」这一态；访问范围由后端 allowedRoots 收口，越界会 403，
    // 那种失败必须如实暴露给用户，不能在这里提前吞掉。
    return { ok: true }
  },

  async list(path, options) {
    void options
    const list = await fsWebApi.getList({ path }, { isToast: false })
    return Array.isArray(list) ? (list as IEntry[]) : []
  },

  url(path) {
    return fsWebApi.getStreamUrl(path)
  },

  async writeText(dirPath, name, content, options: FsWriteOptions = {}) {
    return await serverBackend.writeFile(dirPath, name, generateTextFile(content, name), options)
  },

  async writeFile(dirPath, name, data, options: FsWriteOptions = {}) {
    const path = normalizePath(joinPath(dirPath, name))
    const conflict = options.conflict ?? 'error'

    if (conflict === 'skip' && await serverBackend.exists(path)) {
      return { ok: false, reason: 'skipped' }
    }

    const file = data instanceof File ? data : new File([data], name)
    await fsWebApi.uploadFile({
      path,
      file,
      onConflict: conflict === 'keep-both' ? 'keep-both' : conflict === 'error' ? 'error' : 'overwrite',
    }, {
      signal: options.signal,
      onUploadProgress: options.onProgress
        ? (event: { loaded?: number }) => options.onProgress?.(event.loaded ?? 0)
        : undefined,
    })
    return { ok: true, path, name }
  },

  async mkdir(path) {
    await fsWebApi.createDir({ path, ignoreExisted: true })
  },

  async rename(fromPath, toPath) {
    await fsWebApi.renameEntry({ fromPath, toPath })
  },

  async remove() {
    // 见文件头注释：服务端的删除是后台任务，不走字节层
    throw new Error('server-side delete goes through the task runner')
  },

  async exists(path) {
    try {
      const { existing } = await fsWebApi.checkExists([path])
      return existing.includes(path)
    }
    catch {
      // 预检失败不该阻断操作：交给真正的写入去报错
      return false
    }
  },

  async uniqueName(dirPath, filename) {
    const dot = filename.lastIndexOf('.')
    const base = dot > 0 ? filename.slice(0, dot) : filename
    const ext = dot > 0 ? filename.slice(dot) : ''
    for (let index = 1; index < 1000; index += 1) {
      const candidate = `${base} (${index})${ext}`
      if (!(await serverBackend.exists(joinPath(dirPath, candidate)))) {
        return candidate
      }
    }
    return `${base} (${Date.now()})${ext}`
  },
}

/** 供 `writeText` 之外的上传路径复用（上传队列仍直接走 API）。 */
export { joinPath as joinServerPath, parentOf as serverParentOf }
