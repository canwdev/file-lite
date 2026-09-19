import type { FsBackend, FsConflictPolicy, FsWriteOptions, FsWriteResult } from './backend'
/**
 * 统一的文件门面。
 *
 * 这是**前端唯一应该决定「走哪个存储后端」的地方**。调用点（Apps、ExplorerPane、
 * 编辑器、剪贴板粘贴…）只面向 `fs`，传路径就行，不需要知道它属于服务端还是浏览器
 * 挂载卷。
 *
 * 为什么要有它：那种 `if (isMountedPath(p))` 的判断过去散布在各个 app 里，结果是
 * 「A 处记得问只读守卫、B 处忘了」——写挂载卷时静默走到服务端、或者绕过只读检查。
 * 收口之后，只读守卫只在 `canWrite`/`write*` 里出现一次。
 *
 * 它**不**统一任务编排：复制 / 移动 / 删除的进度、冲突、取消属于上层执行器
 * （`client-tasks` 与服务端任务），本层只做字节与元数据。
 */
import type { IEntry } from '@/types/server'
import { getBrowserBackend, hasBrowserBackend, registerBrowserBackend } from './backend'
import { browserBackend } from './browser-backend'
import { isMountedPath, mountIdFromPath, mountRootPath, needsClientExecution, relativePathInMount } from './paths'
import { serverDownloadUrl as downloadUrlOf, serverBackend, serverDrives, serverOpenInHostExplorer, serverUpload } from './server-backend'

export type { FsBackend, FsConflictPolicy, FsWriteOptions, FsWriteResult } from './backend'
export { MountedFsError } from './browser-backend'

// 两个后端都在这里登记：本模块是唯一入口，登记一次就够
registerBrowserBackend(browserBackend)

/** 只做分派的纯函数；`isMountedPath` 是唯一的判断点。 */
export function backendFor(path: string): FsBackend {
  return isMountedPath(path) ? getBrowserBackend() : serverBackend
}

/**
 * 该路径当前能不能写；不能写时 `reason` 直接可以展示给用户。
 *
 * 只做转交：**谁来回答**取决于路径属于哪个后端，而「能不能写」由后端自己定义
 * （服务端没有只读态，挂载卷要查授权）。
 */
export function canWrite(path: string): Promise<{ ok: boolean, reason?: string }> {
  return backendFor(path).canWrite(path)
}

/**
 * 写操作统一入口：先问能不能写，再执行。
 *
 * 过去的写法是每个调用点自己 `if (isMountedPath) { 守卫; 原语 } else { API }`，
 * 漏掉任意一处就会写坏体验（发起一个必然失败的服务端请求，或者绕过只读提示）。
 * 现在只需要在这里问一次。
 *
 * 返回 `ok: false` 表示**没有执行**，`reason` 已经可以是展示文案；调用方不必再
 * 自己判断「是不是因为只读没做」。
 */
export async function writeText(
  dirPath: string,
  name: string,
  content: string,
  options: FsWriteOptions = {},
): Promise<FsWriteResult> {
  // 不再在这里预检：后端自己的 `writeText` 会在写之前守卫，避免「同一件事问两遍、
  // 两处答案可能不一致」。门面只负责把路径转给正确的后端。
  return await backendFor(dirPath).writeText(dirPath, name, content, options)
}

/** 写二进制内容（剪贴板图片等），同样先过只读守卫。 */
export async function writeFile(
  dirPath: string,
  name: string,
  data: BlobPart,
  options: FsWriteOptions = {},
): Promise<FsWriteResult> {
  return await backendFor(dirPath).writeFile(dirPath, name, data, options)
}

/** 列目录。 */
export function list(path: string, options?: { showHidden?: boolean }): Promise<IEntry[]> {
  return backendFor(path).list(path, options)
}

/** 文件的访问地址（服务端 HTTP URL / 挂载卷 objectURL）。 */
export function url(path: string): string {
  return backendFor(path).url(path)
}

/** 创建目录。 */
export async function mkdir(path: string, options: { recursive?: boolean } = {}): Promise<void> {
  const guard = await canWrite(path)
  if (!guard.ok) {
    throw new Error(guard.reason ?? 'this location is read-only')
  }
  await backendFor(path).mkdir(path, options)
}

/** 重命名 / 移动（同后端内）。 */
export async function rename(fromPath: string, toPath: string): Promise<void> {
  const guard = await canWrite(fromPath)
  if (!guard.ok) {
    throw new Error(guard.reason ?? 'this location is read-only')
  }
  await backendFor(fromPath).rename(fromPath, toPath)
}

/** 删除（目录递归）。服务端删除是后台任务，调用它会抛错——见 `server-backend.ts`。 */
export async function remove(path: string): Promise<void> {
  const guard = await canWrite(path)
  if (!guard.ok) {
    throw new Error(guard.reason ?? 'this location is read-only')
  }
  await backendFor(path).remove(path)
}

/**
 * 批量判断路径是否存在（上传 / 复制前的冲突预检）。
 *
 * 按后端分组再问：把一组里混着的服务端路径发给挂载卷后端（或反过来）都是错的，
 * 而这正是「预检漏了挂载卷」那类 bug 的来源。
 */
export async function existingPaths(paths: string[]): Promise<string[]> {
  const groups = new Map<FsBackend, string[]>()
  for (const path of paths) {
    const backend = backendFor(path)
    const group = groups.get(backend)
    if (group) {
      group.push(path)
    }
    else {
      groups.set(backend, [path])
    }
  }

  const results = await Promise.all([...groups.entries()].map(async ([backend, group]) => {
    // 后端没有批量接口就逐条问；两个实现目前都是逐条，分组本身已经避免发错后端
    const flags = await Promise.all(group.map(path => backend.exists(path)))
    return group.filter((_, index) => flags[index])
  }))
  return results.flat()
}

/** 该路径是否已存在。 */
export function exists(path: string): Promise<boolean> {
  return backendFor(path).exists(path)
}

/**
 * 下载地址。只对服务端有意义（挂载卷的文件已经在本地，没有「下载」这回事），
 * 但放在门面里是为了让调用点不必自己判断。
 */
export function downloadUrl(paths: string[]): string {
  return downloadUrlOf(paths)
}

/** 在宿主机资源管理器里打开若干路径（服务端能力）。 */
export async function openInHostExplorer(paths: string[]) {
  await serverOpenInHostExplorer(paths)
}

/** 驱动器 / 挂载点列表（侧边栏与跨卷判定用）。 */
export const drives: FsBackend['list'] extends never ? never : () => ReturnType<typeof serverDrives> = serverDrives

/**
 * 上传一个 `File` 到服务端。
 *
 * 上传队列专用：它需要服务端返回的最终路径（keep-both 会改名）与上传进度。
 * 目标是挂载卷时**必须**走客户端任务，所以这里显式拒绝，避免又一条 404。
 */
export async function upload(
  path: string,
  file: File,
  onConflict: FsConflictPolicy = 'error',
  options: { signal?: AbortSignal, onProgress?: (loaded: number) => void } = {},
) {
  if (isMountedPath(path)) {
    throw new Error('Cannot upload to a browser-mounted folder: use a client task instead')
  }
  return await serverUpload(path, file, onConflict, options)
}

/** 在 `dirPath` 下取一个没被占用的 `keep-both` 名字。 */
export function uniqueName(dirPath: string, filename: string): Promise<string> {
  return backendFor(dirPath).uniqueName(dirPath, filename)
}

/** 读取文本内容；服务端走 `/stream`，挂载卷读句柄。 */
export async function readText(path: string, options: { signal?: AbortSignal } = {}): Promise<string> {
  if (isMountedPath(path)) {
    const { readMountedText } = await import('./browser-backend')
    return await readMountedText(path)
  }
  const { fsWebApi } = await import('@/api/filesystem')
  const data = await fsWebApi.stream(path, { responseType: 'text', signal: options.signal })
  return data as unknown as string
}

/**
 * 命名空间门面：调用点习惯写 `fs.writeText(...)`（与后端 API 对象的用法一致）。
 * 具名导出同样可用，两者指向同一批函数。
 */
export const fs = {
  backendFor,
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

export { hasBrowserBackend, isMountedPath, mountIdFromPath, mountRootPath, needsClientExecution, relativePathInMount }
