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
import { normalizePath } from '@/utils/path/form'

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

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
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
    const { existing } = await fsWebApi.checkExists([path])
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
}

/** 列目录。 */
export async function list(path: string, options?: { showHidden?: boolean }): Promise<IEntry[]> {
  void options
  const result = await fsWebApi.getList({ path }, { isToast: false })
  return Array.isArray(result) ? (result as IEntry[]) : []
}

/** 文件的访问地址（HTTP URL）。 */
export function url(path: string): string {
  return fsWebApi.getStreamUrl(path)
}

/** 创建目录。 */
export async function mkdir(path: string, options: { recursive?: boolean } = {}): Promise<void> {
  void options
  await fsWebApi.createDir({ path, ignoreExisted: true })
}

/** 重命名 / 移动（服务端）。 */
export async function rename(fromPath: string, toPath: string): Promise<void> {
  await fsWebApi.renameEntry({ fromPath, toPath })
}

/**
 * 批量判断路径是否存在（上传 / 复制前的冲突预检）。
 *
 * 后端没有批量接口就逐条问。
 */
export async function existingPaths(paths: string[]): Promise<string[]> {
  const flags = await Promise.all(paths.map(path => exists(path)))
  return paths.filter((_, index) => flags[index])
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
  mkdir,
  rename,
  existingPaths,
  drives,
  upload,
  openInHostExplorer,
  downloadUrl,
}
