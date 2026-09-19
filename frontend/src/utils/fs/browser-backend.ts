import type { FsBackend, FsWriteOptions, FsWriteResult } from './backend'
/**
 * 浏览器挂载的本地文件夹（File System Access API）。
 *
 * 这里只做**读写原语**，不含挂载表与权限状态——那些是 `mounted-volumes.ts`
 * （idb + vue）的事，句柄由它通过注入提供。这样本模块没有 vue / idb 依赖，
 * 可以被 app 层直接使用，也可以单独测。
 *
 * 它实现的正是 `FsBackend`：调用方面向 `fs`（`./index`），不必知道路径属于哪一侧。
 */
import type { IEntry } from '@/types/server'
import { mountIdFromPath, mountRootPath, relativePathInMount } from './paths'

export type MountedFsErrorCode
  = | 'not-mounted-path' // 根本不属于挂载命名空间
    | 'unknown-mount' // 属于该命名空间，但卷已卸载 / 不存在
    | 'not-found' // 卷内路径不存在（文件夹被移动或删除了）
    | 'not-directory'
    | 'permission'

export class MountedFsError extends Error {
  code: MountedFsErrorCode

  constructor(code: MountedFsErrorCode, message: string) {
    super(message)
    this.name = 'MountedFsError'
    this.code = code
  }
}

/**
 * 取某个挂载 id 的目录句柄。由 `mounted-volumes.ts` 注入。
 *
 * 注入而非直接 import：本模块要在共享层（`utils/fs/`）落脚，不能反过来依赖视图层。
 */
let handleResolver: ((id: string) => Promise<FileSystemDirectoryHandle | null>) | null = null

export function setMountedHandleResolver(resolver: (id: string) => Promise<FileSystemDirectoryHandle | null>) {
  handleResolver = resolver
}

/**
 * 写权限守卫。由 `mounted-volumes.ts` 注入——只有它知道每个卷的授权状态。
 *
 * 放在注入点而不是门面里：门面只该回答「这条路径归谁管」，「这个卷现在能不能写」
 * 是挂载表的知识。这样后半段判断也只有一处。
 */
let writeGuard: ((path: string) => { ok: boolean, reason?: string }) | null = null

export function setMountedWriteGuard(guard: (path: string) => { ok: boolean, reason?: string }) {
  writeGuard = guard
}

function canWriteMounted(path: string): { ok: boolean, reason?: string } {
  return writeGuard ? writeGuard(path) : { ok: true }
}

async function rootHandle(id: string): Promise<FileSystemDirectoryHandle> {
  const handle = handleResolver ? await handleResolver(id) : null
  if (!handle) {
    throw new MountedFsError('unknown-mount', `mounted volume not found: ${id}`)
  }
  return handle
}

/** 被隐藏的文件名。与后端 `hidden` 的语义一致：点开头一律算隐藏。 */
function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

function entryExt(name: string, isDirectory: boolean): string {
  if (isDirectory) {
    return ''
  }
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

function dirEntry(name: string): IEntry {
  return {
    name,
    ext: '',
    isDirectory: true,
    hidden: isHiddenName(name),
    // 目录的名称之外的信息（大小 / 时间）要逐个子项读成 File 才能拿到，
    // 代价是一次额外的磁盘 IO。与后端「拿不到就不编造」的取舍一致。
    lastModified: 0,
    birthtime: 0,
    size: null,
    error: null,
  }
}

function fileEntry(file: File): IEntry {
  return {
    name: file.name,
    ext: entryExt(file.name, false),
    isDirectory: false,
    hidden: isHiddenName(file.name),
    lastModified: file.lastModified,
    // 浏览器不暴露创建时间
    birthtime: 0,
    size: file.size,
    error: null,
  }
}

/**
 * 把卷内相对路径解析成目录句柄。
 *
 * 逐段 `getDirectoryHandle` 而不是缓存句柄：目录可能在浏览器之外被改名或删除，
 * 每次都重新解析才能得到准确的 not-found，而不是拿着过期句柄操作错对象。
 */
export async function resolveMountedDirHandle(path: string): Promise<FileSystemDirectoryHandle> {
  const id = mountIdFromPath(path)
  if (!id) {
    throw new MountedFsError('not-mounted-path', `not a mounted path: ${path}`)
  }
  const root = await rootHandle(id)

  const relative = relativePathInMount(path, id)
  if (relative === null) {
    throw new MountedFsError('not-mounted-path', `path does not belong to ${id}: ${path}`)
  }
  if (!relative) {
    return root
  }

  let current = root
  const segments = relative.split('/').filter(Boolean)
  for (let index = 0; index < segments.length; index += 1) {
    const label = segments.slice(0, index + 1).join('/')
    try {
      current = await current.getDirectoryHandle(segments[index]!)
    }
    catch (error) {
      throw toMountedFsError(error, label)
    }
  }
  return current
}

/** 卷内某个文件的句柄。 */
export async function resolveMountedFileHandle(path: string): Promise<FileSystemFileHandle> {
  const id = mountIdFromPath(path)
  const relative = id ? relativePathInMount(path, id) : null
  if (!id || relative === null) {
    throw new MountedFsError('not-mounted-path', `not a mounted path: ${path}`)
  }
  if (!relative) {
    throw new MountedFsError('not-directory', 'the mounted volume root is a directory')
  }

  const segments = relative.split('/').filter(Boolean)
  const name = segments.pop()
  if (!name) {
    throw new MountedFsError('not-found', `empty file name in path: ${path}`)
  }

  const parent = await resolveMountedDirHandle(parentPathOf(path, name))
  try {
    return await parent.getFileHandle(name)
  }
  catch (error) {
    throw toMountedFsError(error, relative)
  }
}

/**
 * 去掉路径最后一段，得到父目录路径。
 *
 * 到挂载根为止：`/@mounted/<id>/a.txt` 的父目录是卷根 `/@mounted/<id>/`，
 * **不能**继续剥成 `/@mounted`——那不是一条合法挂载路径，后续解析会直接失败。
 */
export function parentPathOf(path: string, lastSegment: string): string {
  const cut = path.length - lastSegment.length - 1
  const parent = cut > 0 ? path.slice(0, cut) : path
  if (mountIdFromPath(parent) === null && mountIdFromPath(path) !== null) {
    return mountRootOfListingPath(path)
  }
  return parent
}

function mountRootOfListingPath(path: string): string {
  const id = mountIdFromPath(path)
  return id ? mountRootPath(id) : path
}

function lastPathSegment(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? ''
}

function toMountedFsError(error: unknown, label: string): MountedFsError {
  if (error instanceof MountedFsError) {
    return error
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError' || error.name === 'TypeMismatchError') {
      return new MountedFsError('not-found', `not found in mounted folder: ${label}`)
    }
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new MountedFsError('permission', `permission denied: ${label}`)
    }
  }
  return new MountedFsError('not-found', `failed to read ${label}`)
}

/** 读一个卷内目录的子项。文件按**串行**逐个取值：并发读上百个句柄会把磁盘打爆。 */
export async function readMountedDir(path: string, options: { showHidden?: boolean } = {}): Promise<IEntry[]> {
  const handle = await resolveMountedDirHandle(path)

  let children: FileSystemHandle[]
  try {
    children = []
    for await (const child of handle.values()) {
      children.push(child)
    }
  }
  catch (error) {
    throw toMountedFsError(error, path)
  }

  const entries: IEntry[] = []
  for (const child of children) {
    if (!options.showHidden && isHiddenName(child.name)) {
      continue
    }
    if (child.kind === 'directory') {
      entries.push(dirEntry(child.name))
      continue
    }
    // lib.dom 里 `values()` 的联合类型不是可辨识联合，收不窄，只能显式断言
    const fileHandle = child as FileSystemFileHandle
    try {
      entries.push(fileEntry(await fileHandle.getFile()))
    }
    catch (error) {
      // 单个文件读不到（并发删除、权限收紧）不该让整个目录打不开
      entries.push({
        ...dirEntry(child.name),
        isDirectory: false,
        ext: entryExt(child.name, false),
        error: error instanceof Error ? error.message : 'read failed',
      })
    }
  }
  return entries
}

/** 读取卷内一个文件。 */
export async function readMountedFile(path: string): Promise<File> {
  const handle = await resolveMountedFileHandle(path)
  try {
    return await handle.getFile()
  }
  catch (error) {
    throw toMountedFsError(error, path)
  }
}

/** 读取卷内一个文本文件。 */
export async function readMountedText(path: string): Promise<string> {
  return await (await readMountedFile(path)).text()
}

/** 创建（或复用）卷内目录。 */
export async function createMountedDir(path: string): Promise<void> {
  const name = lastPathSegment(path)
  if (!name) {
    return
  }
  const parent = await resolveMountedDirHandle(parentPathOf(path, name))
  await parent.getDirectoryHandle(name, { create: true })
}

/** 在卷内写一个文件，写入流由调用方提供（复制时用，自带背压）。 */
export async function writeMountedFileFromStream(
  dirPath: string,
  filename: string,
  body: ReadableStream<Uint8Array>,
): Promise<void> {
  const dir = await resolveMountedDirHandle(dirPath)
  const writable = await (await dir.getFileHandle(filename, { create: true }))
    .createWritable({ keepExistingData: false })

  try {
    await body.pipeTo(writable)
  }
  catch (error) {
    await writable.abort().catch(() => {})
    throw toMountedFsError(error, filename)
  }
}

/** 在卷内写一个文件，内容由调用方一次性提供。 */
export async function writeMountedFile(dirPath: string, filename: string, data: BlobPart): Promise<void> {
  const dir = await resolveMountedDirHandle(dirPath)
  const writable = await (await dir.getFileHandle(filename, { create: true }))
    .createWritable({ keepExistingData: false })
  try {
    await writable.write(data)
    await writable.close()
  }
  catch (error) {
    await writable.abort().catch(() => {})
    throw toMountedFsError(error, filename)
  }
}

/** 删除卷内的一个文件或目录（目录递归）。挂载根的删除会被浏览器拒绝，如实报错。 */
export async function removeMountedEntry(path: string): Promise<void> {
  const name = lastPathSegment(path)
  if (!name) {
    throw new MountedFsError('not-found', 'refusing to remove the mounted root')
  }
  const parent = await resolveMountedDirHandle(parentPathOf(path, name))
  try {
    await parent.removeEntry(name, { recursive: true })
  }
  catch (error) {
    throw toMountedFsError(error, path)
  }
}

/** 卷内某个名字是否已被占用。 */
export async function mountedEntryExists(dirPath: string, name: string): Promise<boolean> {
  const dir = await resolveMountedDirHandle(dirPath)
  try {
    await dir.getFileHandle(name)
    return true
  }
  catch {
    try {
      await dir.getDirectoryHandle(name)
      return true
    }
    catch {
      return false
    }
  }
}

/**
 * 卷内重命名。
 *
 * 优先用 `FileSystemFileHandle.move()`——同卷内它是**零拷贝**的，浏览器直接改目录项。
 * 它没有跨目录保证、也未必在所有实现里可用，所以拿不到 `move` 时退回
 * 「读出来 + 写新名 + 删旧名」。
 */
export async function renameMountedEntry(fromPath: string, toPath: string): Promise<void> {
  const fromName = lastPathSegment(fromPath)
  const toName = lastPathSegment(toPath)
  const fromDir = await resolveMountedDirHandle(parentPathOf(fromPath, fromName))
  const toDir = await resolveMountedDirHandle(parentPathOf(toPath, toName))

  const sameDir = parentPathOf(fromPath, fromName) === parentPathOf(toPath, toName)
  if (sameDir && fromName === toName) {
    return
  }

  const entry = await findEntry(fromDir, fromName)
  if (!entry) {
    throw new MountedFsError('not-found', `not found in mounted folder: ${fromName}`)
  }

  const move = (entry as FileSystemHandle & { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> }).move
  if (typeof move === 'function') {
    try {
      await move.call(entry, toDir, toName)
      return
    }
    catch (error) {
      // 只读目录、跨文件系统等：退回下面的复制方案，而不是直接失败
      console.warn('[mounted] move() failed, falling back to copy', error)
    }
  }

  if (entry.kind === 'directory') {
    throw new MountedFsError('permission', `renaming a folder is not supported: ${fromName}`)
  }
  const fileHandle = entry as FileSystemFileHandle
  const body = (await fileHandle.getFile()).stream()
  await writeMountedFileFromStream(parentPathOf(toPath, toName), toName, body)
  await fromDir.removeEntry(fromName, { recursive: false })
}

async function findEntry(dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemHandle | null> {
  try {
    return await dir.getFileHandle(name)
  }
  catch {
    try {
      return await dir.getDirectoryHandle(name)
    }
    catch {
      return null
    }
  }
}

/**
 * `FsBackend` 的挂载卷实现。
 *
 * `canWrite` 在这里是**结构性**的：本模块只管句柄能不能被浏览器接受写，真正的
 * 「只读 / 未授权」状态由 `mounted-volumes.ts` 的守卫回答（它知道权限）。所以
 * 这里一律放行，由 `fs`（`./index`）先问守卫再落到这里。
 */
export const browserBackend: FsBackend = {
  async canWrite(path) {
    return canWriteMounted(path)
  },

  list(path, options) {
    return readMountedDir(path, options)
  },

  url(path) {
    // 挂载卷没有 HTTP 地址；objectURL 由 `file-url.ts` 缓存层负责创建与释放
    void path
    return ''
  },

  async writeText(dirPath, name, content, options: FsWriteOptions = {}) {
    const guard = canWriteMounted(joinPath(dirPath, name))
    if (!guard.ok) {
      return { ok: false, reason: guard.reason }
    }
    const conflict = options.conflict ?? 'error'
    if (conflict === 'skip' && await mountedEntryExists(dirPath, name)) {
      return { ok: false, reason: 'skipped' }
    }
    const finalName = conflict === 'keep-both' ? await browserBackend.uniqueName(dirPath, name) : name
    await writeMountedFile(dirPath, finalName, content)
    return { ok: true, path: `${dirPath.replace(/\/+$/, '')}/${finalName}`, name: finalName }
  },

  async writeFile(dirPath, name, data, options: FsWriteOptions = {}) {
    const guard = canWriteMounted(joinPath(dirPath, name))
    if (!guard.ok) {
      return { ok: false, reason: guard.reason }
    }
    const conflict = options.conflict ?? 'error'
    if (conflict === 'skip' && await mountedEntryExists(dirPath, name)) {
      return { ok: false, reason: 'skipped' }
    }
    const finalName = conflict === 'keep-both' ? await browserBackend.uniqueName(dirPath, name) : name
    await writeMountedFile(dirPath, finalName, data)
    return { ok: true, path: `${dirPath.replace(/\/+$/, '')}/${finalName}`, name: finalName }
  },

  mkdir(path) {
    return createMountedDir(path)
  },

  rename(fromPath, toPath) {
    return renameMountedEntry(fromPath, toPath)
  },

  remove(path) {
    return removeMountedEntry(path)
  },

  exists(path) {
    return mountedEntryExists(parentPathOf(path, lastPathSegment(path)), lastPathSegment(path))
  },

  async uniqueName(dirPath, filename) {
    const dot = filename.lastIndexOf('.')
    const base = dot > 0 ? filename.slice(0, dot) : filename
    const ext = dot > 0 ? filename.slice(dot) : ''
    for (let index = 1; index < 1000; index += 1) {
      const candidate = `${base} (${index})${ext}`
      if (!(await mountedEntryExists(dirPath, candidate))) {
        return candidate
      }
    }
    return `${base} (${Date.now()})${ext}`
  },
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

/** 该结果是否算「失败」（供调用方统一处理）。 */
export function writeFailed(result: FsWriteResult): boolean {
  return !result.ok
}
