/**
 * 统一的文件门面。
 *
 * 调用点（Apps、ExplorerPane、编辑器、剪贴板粘贴…）只面向 `fs`，传路径就行，不直接
 * 调文件 API。复制 / 移动 / 删除这类会触碰多条目的操作属于任务层（进度、冲突、取消），
 * 本层只做**字节与元数据**。
 *
 * 为什么要有它：文件 API 曾经散布在各个 app 里，收口之后「写之前问一次能不能写」
 * 这类规则只在一处。
 */
import type { IEntry } from '@/types/server'
import { fsWebApi } from '@/api/filesystem'
import { joinPath, normalizePath } from '@/utils/path/form'

/** 同名冲突策略。与服务端 `upload-file` 的 `onConflict` 及上传队列保持一致。 */
export type FsConflictPolicy = 'error' | 'overwrite' | 'keep-both' | 'skip'

export interface FsWriteOptions {
  conflict?: FsConflictPolicy
  signal?: AbortSignal
  /** 已写入的字节数（上传进度用）。 */
  onProgress?: (loaded: number) => void
}

/** 写入结果：`keep-both` 可能改名，调用方需要知道真正的落点。 */
export interface FsWriteResult {
  ok: boolean
  /** 实际写入的路径（keep-both 改名后与请求路径不同） */
  path?: string
  /** 实际写入的文件名 */
  name?: string
  /** 未执行的原因（策略为 skip 等） */
  reason?: string
}

/**
 * 该路径当前能不能写；不能写时 `reason` 直接可以展示给用户。
 *
 * 服务端没有只读态，访问范围由后端 `allowedRoots` 收口，越界会 403——那种失败必须
 * 如实暴露，不能在这里提前吞掉，所以这里恒为可写。
 */
export function canWrite(_path: string): Promise<{ ok: boolean, reason?: string }> {
  return Promise.resolve({ ok: true })
}

/** 该路径是否已存在（上传 / 复制前的冲突预检用）。 */
async function exists(path: string): Promise<boolean> {
  try {
    const { existing } = await fsWebApi.queryEntries([path])
    return existing.includes(path)
  }
  catch {
    // 预检失败不该阻断操作：交给真正的写入去报错
    return false
  }
}

/** 写文本（编辑器保存、新建文件走它）。 */
export async function writeText(
  dirPath: string,
  name: string,
  content: string,
  options: FsWriteOptions = {},
): Promise<FsWriteResult> {
  const file = new File([content], name, { type: 'text/plain;charset=utf-8' })
  return await writeFile(dirPath, name, file, options)
}

/** 写二进制内容（剪贴板图片等）。 */
export async function writeFile(
  dirPath: string,
  name: string,
  data: BlobPart,
  options: FsWriteOptions = {},
): Promise<FsWriteResult> {
  const path = normalizePath(joinPath(dirPath, name))
  const conflict = options.conflict ?? 'error'

  if (conflict === 'skip' && await exists(path)) {
    return { ok: false, reason: 'skipped' }
  }

  const file = data instanceof File ? data : new File([data], name)
  const result = await fsWebApi.uploadFile({
    path,
    file,
    onConflict: conflict === 'keep-both' ? 'keep-both' : conflict === 'error' ? 'error' : 'overwrite',
  }, {
    signal: options.signal,
    onUploadProgress: options.onProgress
      ? (event: { loaded?: number }) => options.onProgress?.(event.loaded ?? 0)
      : undefined,
  }) as unknown as { path?: string, name?: string }
  // keep-both 会被服务端改名：落点以响应为准，不能回显请求里的名字。
  return { ok: true, path: result?.path ?? path, name: result?.name ?? name }
}

/** 列目录。`recursive` 把子目录里的文件摊成一份列表，供资源管理器的平铺视图使用。 */
export async function list(path: string, options?: {
  showHidden?: boolean
  recursive?: boolean
  signal?: AbortSignal
}): Promise<IEntry[]> {
  // 服务端按页返回（默认一页 2000 条）；这里把剩余页取完，调用方拿到的仍是整份列表。
  // 排序 / 分组 / 过滤都在客户端做，少一页就会静默少几行——所以必须取完。
  const entries: IEntry[] = []
  let offset = 0
  for (;;) {
    const result = await fsWebApi.getList({
      path,
      recursive: options?.recursive,
      showHidden: options?.showHidden,
      offset,
    }, { isToast: false, signal: options?.signal })
    const batch = Array.isArray(result?.entries) ? result.entries : []
    entries.push(...batch)

    // 递归平铺不分页（顺序不可续），一次就是全部。
    const total = result?.total ?? entries.length
    if (options?.recursive || batch.length === 0 || entries.length >= total) {
      break
    }
    offset = entries.length
  }

  if (!options?.recursive) {
    return entries
  }

  // 平铺列表的显示名与身份一直是「相对路径」：同名文件可能来自不同子目录，
  // 只留 basename 会让选中、排序、去重撞在一起。服务端现在同时给 relativePath 与
  // canonical path，这里只把显示名换回相对路径，落到文件系统时用 path。
  return entries.map(entry => ({ ...entry, name: entry.relativePath ?? entry.name }))
}

/** 文件的访问地址（HTTP URL）。 */
export function url(path: string): string {
  return fsWebApi.getStreamUrl(path)
}

/** 创建目录。 */
export async function mkdir(path: string, options: { recursive?: boolean } = {}): Promise<void> {
  void options
  await fsWebApi.createDir({ path })
}

/** 重命名 / 移动（服务端）。 */
export async function rename(fromPath: string, toPath: string): Promise<void> {
  await fsWebApi.renameEntry({ fromPath, toPath })
}

/**
 * 批量判断路径是否存在（上传 / 复制前的冲突预检）。
 *
 * 一次请求问完一批：服务端自己并发 stat，比每个文件问一次省掉 N-1 次往返。
 * 写的时候仍由 PUT 的前置条件兜底，所以这里只用于展示冲突对话框。
 */
export async function existingPaths(paths: string[]): Promise<string[]> {
  if (!paths.length) {
    return []
  }
  try {
    const { existing } = await fsWebApi.queryEntries(paths)
    return paths.filter(path => existing.includes(path))
  }
  catch {
    // 预检失败不该阻断操作：交给真正的写入去报错
    return []
  }
}

/** 下载地址（多路径会打包成 zip，由后端决定）。 */
export function downloadUrl(paths: string[]): string {
  return fsWebApi.getDownloadUrl(paths)
}

/** 在宿主机资源管理器里打开若干路径。 */
export async function openInHostExplorer(paths: string[]) {
  await fsWebApi.openInHostExplorer({ paths })
}

/** 驱动器 / 挂载点列表（侧边栏与跨卷判定用）。 */
export async function drives() {
  return await fsWebApi.getDrives()
}

/**
 * 上传一个 `File` 到服务端。
 *
 * 上传队列专用：它需要服务端返回的最终路径（keep-both 会改名）与上传进度。
 */
export async function upload(
  path: string,
  file: File,
  onConflict: FsConflictPolicy = 'error',
  options: { signal?: AbortSignal, onProgress?: (loaded: number) => void } = {},
) {
  // 服务端上传接口没有 skip（跳过由调用方自己判断），这里映射掉
  const policy = onConflict === 'skip' ? 'error' : onConflict
  return await fsWebApi.uploadFile(
    { path, file, onConflict: policy },
    {
      signal: options.signal,
      onUploadProgress: options.onProgress
        ? (event: { loaded?: number }) => options.onProgress?.(event.loaded ?? 0)
        : undefined,
    },
  )
}

/** 读取文本内容。 */
export async function readText(path: string, options: { signal?: AbortSignal } = {}): Promise<string> {
  const data = await fsWebApi.stream(path, { responseType: 'text', signal: options.signal })
  return data as unknown as string
}

/** 读取二进制内容（图片编辑等需要拿到原始字节的调用点）。 */
export async function readBlob(path: string, options: { signal?: AbortSignal } = {}): Promise<Blob> {
  const data = await fsWebApi.stream(path, { responseType: 'blob', signal: options.signal })
  return data as unknown as Blob
}

/**
 * 命名空间门面：调用点习惯写 `fs.writeText(...)`（与后端 API 对象的用法一致）。
 * 具名导出同样可用，两者指向同一批函数。
 */
export const fs = {
  canWrite,
  writeText,
  writeFile,
  list,
  url,
  readText,
  readBlob,
  mkdir,
  rename,
  existingPaths,
  drives,
  upload,
  openInHostExplorer,
  downloadUrl,
}
