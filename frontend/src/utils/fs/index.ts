import type { FsConflictPolicy, FsWriteOptions, FsWriteResult } from './backend'
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
import {
  serverDownloadUrl as downloadUrlOf,
  serverBackend,
  serverDrives,
  serverOpenInHostExplorer,
  serverUpload,
} from './server-backend'

export type { FsBackend, FsConflictPolicy, FsWriteOptions, FsWriteResult } from './backend'

/**
 * 该路径当前能不能写；不能写时 `reason` 直接可以展示给用户。
 *
 * 只做转交：服务端没有只读态，访问范围由后端 `allowedRoots` 收口，越界会 403，
 * 那种失败必须如实暴露，不能在这里提前吞掉。
 */
export function canWrite(path: string): Promise<{ ok: boolean, reason?: string }> {
  return serverBackend.canWrite(path)
}

/** 写文本（编辑器保存、新建文件走它）。 */
export async function writeText(
  dirPath: string,
  name: string,
  content: string,
  options: FsWriteOptions = {},
): Promise<FsWriteResult> {
  return await serverBackend.writeText(dirPath, name, content, options)
}

/** 写二进制内容（剪贴板图片等）。 */
export async function writeFile(
  dirPath: string,
  name: string,
  data: BlobPart,
  options: FsWriteOptions = {},
): Promise<FsWriteResult> {
  return await serverBackend.writeFile(dirPath, name, data, options)
}

/** 列目录。 */
export function list(path: string, options?: { showHidden?: boolean }): Promise<IEntry[]> {
  return serverBackend.list(path, options)
}

/** 文件的访问地址（服务端 HTTP URL）。 */
export function url(path: string): string {
  return serverBackend.url(path)
}

/** 创建目录。 */
export async function mkdir(path: string, options: { recursive?: boolean } = {}): Promise<void> {
  const guard = await canWrite(path)
  if (!guard.ok) {
    throw new Error(guard.reason ?? 'this location is read-only')
  }
  await serverBackend.mkdir(path, options)
}

/** 重命名 / 移动（服务端）。 */
export async function rename(fromPath: string, toPath: string): Promise<void> {
  const guard = await canWrite(fromPath)
  if (!guard.ok) {
    throw new Error(guard.reason ?? 'this location is read-only')
  }
  await serverBackend.rename(fromPath, toPath)
}

/** 删除。服务端删除是后台任务，调用它会抛错——见 `server-backend.ts`。 */
export async function remove(path: string): Promise<void> {
  const guard = await canWrite(path)
  if (!guard.ok) {
    throw new Error(guard.reason ?? 'this location is read-only')
  }
  await serverBackend.remove(path)
}

/**
 * 批量判断路径是否存在（上传 / 复制前的冲突预检）。
 *
 * 后端没有批量接口就逐条问。
 */
export async function existingPaths(paths: string[]): Promise<string[]> {
  const flags = await Promise.all(paths.map(path => serverBackend.exists(path)))
  return paths.filter((_, index) => flags[index])
}

/** 该路径是否已存在。 */
export function exists(path: string): Promise<boolean> {
  return serverBackend.exists(path)
}

/** 下载地址（多路径会打包成 zip，由后端决定）。 */
export function downloadUrl(paths: string[]): string {
  return downloadUrlOf(paths)
}

/** 在宿主机资源管理器里打开若干路径。 */
export async function openInHostExplorer(paths: string[]) {
  await serverOpenInHostExplorer(paths)
}

/** 驱动器 / 挂载点列表（侧边栏与跨卷判定用）。 */
export const drives = serverDrives

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
  return await serverUpload(path, file, onConflict, options)
}

/** 在 `dirPath` 下取一个没被占用的 `keep-both` 名字。 */
export function uniqueName(dirPath: string, filename: string): Promise<string> {
  return serverBackend.uniqueName(dirPath, filename)
}

/** 读取文本内容。 */
export async function readText(path: string, options: { signal?: AbortSignal } = {}): Promise<string> {
  const { fsWebApi } = await import('@/api/filesystem')
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
  remove,
  exists,
  existingPaths,
  drives,
  upload,
  openInHostExplorer,
  downloadUrl,
  uniqueName,
}
