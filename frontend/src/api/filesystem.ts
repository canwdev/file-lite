import type { IDrive, IEntry } from '@/types/server'
import type { ServiceRequestConfig } from '@/utils/service'
import qs from 'qs'
import service from '@/utils/service'

/**
 * 把 canonical 路径编码进 URL 的最后一段。
 *
 * 路径是资源标识，必须整体百分号编码（见 docs/design/api.md §2）：encodeURIComponent
 * 会把 "/" 编成 %2F，而服务端在原始路径上匹配路由，所以它不会变成目录分隔符。
 *
 * 这是全项目唯一拼这些 URL 的地方——包括给 `<img>` / `<video>` / `<a download>` 用的
 * 那些，调用点不要自己拼路径。
 */
function entryUrl(representation: string, path: string): string {
  return `/api/fs/${representation}/${encodeURIComponent(path)}`
}

/** 列目录的响应（docs/design/api.md §6）。 */
export interface ListResult {
  path: string
  offset: number
  limit: number
  total: number
  truncated?: boolean
  entries: IEntry[]
}

/** 上传同名冲突策略。 */
export type UploadConflictPolicy = 'error' | 'overwrite' | 'keep-both'

export const fsWebApi = {
  /** 侧边栏里的可导航位置（卷 / 网络位置 / Home）。 */
  async getDrives() {
    return (await service.get(`/api/volumes`)) as unknown as IDrive[]
  },
  /**
   * 列目录。`recursive` 把子目录里的文件摊平（`relativePath` 是相对路径，`name`
   * 是 basename）；`offset`/`limit` 是非递归列表的分页。
   */
  async getList(
    params: { path: string, recursive?: boolean, showHidden?: boolean, offset?: number, limit?: number } = { path: '' },
    config: ServiceRequestConfig = {},
  ) {
    const { path, recursive, showHidden, offset, limit } = params
    return await service.get(entryUrl('directories', path), {
      params: {
        ...(recursive ? { recursive: 1, showHidden: showHidden ? 1 : 0 } : {}),
        ...(offset ? { offset } : {}),
        ...(limit ? { limit } : {}),
      },
      ...config,
    }) as unknown as ListResult
  },
  /** 单个条目的元数据，供改名 / 原地变更之后只刷新一行。 */
  async getEntry(path: string) {
    return (await service.get(entryUrl('entries', path))) as unknown as { path: string, entry: IEntry }
  },
  // ---- 写入端点 ----

  /** 建目录（含缺失的父级）。幂等：已存在时服务端回 200，新建回 201。 */
  createDir(params: { path: string }) {
    return service.put(entryUrl('directories', params.path))
  },
  /**
   * 写入一个文件：请求体就是文件内容（PUT），不是 multipart。
   *
   * 同名策略用标准前置条件表达：
   *   - `error`      → `If-None-Match: *`，已存在时服务端回 412（前端据此弹冲突对话框）
   *   - `overwrite`  → 不带前置条件，直接覆盖
   *   - `keep-both`  → `?onConflict=keep-both`，服务端改写成 "name (1).ext"
   *
   * `ifMatch` 用于「只有文件没被别人改过才覆盖」，值来自列表或 HEAD 的 ETag。
   */
  uploadFile(
    params: { path: string, file: File, onConflict?: UploadConflictPolicy, ifMatch?: string },
    config: ServiceRequestConfig = {},
  ) {
    const { path, file, onConflict, ifMatch } = params
    const headers: Record<string, string> = {}
    if (onConflict === 'error') {
      headers['If-None-Match'] = '*'
    }
    if (ifMatch) {
      headers['If-Match'] = ifMatch
    }

    return service.put(entryUrl('content', path), file, {
      ...(onConflict === 'keep-both' ? { params: { onConflict: 'keep-both' } } : {}),
      headers,
      ...config,
    })
  },
  /**
   * 批量回答「这些路径现在存在吗」，供上传前的冲突对话框一次问清一批。
   *
   * 服务端按 canonical 路径查，回显的是调用方传进来的原字符串（调用方要拿它做
   * 等值比较）；写的时候仍由 PUT 的前置条件兜底，所以这个答案只用于展示。
   */
  async queryEntries(paths: string[]) {
    return (await service.post(`/api/fs/entry-queries`, { paths })) as unknown as { existing: string[] }
  },
  /**
   * 改名（同目录内换名字）。跨目录移动属于任务，不走这里。
   *
   * 服务端只接受名称，所以这里把目标路径的最后一段取出来；调用方两边都在同一目录，
   * 因此不存在解析歧义。
   */
  renameEntry(params: { fromPath: string, toPath: string }) {
    const normalized = params.toPath.replace(/\\/g, '/')
    const index = normalized.lastIndexOf('/')
    const name = index === -1 ? normalized : normalized.slice(index + 1)
    return service.patch(entryUrl('entries', params.fromPath), { name })
  },
  /** 在宿主机的文件管理器里打开若干路径。 */
  openInHostExplorer(params: { paths: string[] }) {
    return service.post(`/api/host/reveals`, params)
  },
  /**
   * 下载地址。传入的必须是**未经编码**的绝对路径，编码在这里统一做一次。
   *
   * 单选文件由服务端直接给字节，目录或多选打包成 zip——调用方不必先判断目标是哪种。
   */
  getDownloadUrl(paths: string[]) {
    const query = qs.stringify({ paths }, { arrayFormat: 'repeat' })
    return `/api/fs/downloads?${query}`
  },
  /**
   * 读取文件字节。缓存由服务端的 ETag 负责：文件没变就是 304，不要塞时间戳
   * 去绕缓存（那会让每次预览都重新下载整份文件）。
   */
  stream(path: string, config: ServiceRequestConfig = {}) {
    return service.get(entryUrl('content', path), {
      ...config,
    })
  },
  getStreamUrl(path: string) {
    if (!path) {
      return ''
    }
    return entryUrl('content', path)
  },
  /**
   * 后端生成的缩略图地址。`kind` 区分图片来源（图片 / ffmpeg 视频封面），
   * 它参与后端的缓存键与 ETag。服务端自己 stat 文件，不信任调用方给的时间戳。
   */
  getThumbnailUrl(path: string, size: number, kind: 'image' | 'video' = 'image') {
    if (!path) {
      return ''
    }
    const params = new URLSearchParams({ size: String(size) })
    if (kind !== 'image') {
      params.set('kind', kind)
    }
    return `${entryUrl('thumbnail', path)}?${params}`
  },
}
