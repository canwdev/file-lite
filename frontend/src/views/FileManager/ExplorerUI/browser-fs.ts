/**
 * 浏览器挂载卷上的读写原语。
 *
 * 与后端的对应关系：这里的函数刻意对齐 `fsWebApi` 的同名能力——
 * `readMountedDir` ↔ `GET /api/files/list`、`mountedStreamUrl` ↔
 * `GET /api/files/stream`——两者的返回值（`IEntry[]` / 可喂给 `<img>` `<video>` 的
 * 地址）形态一致，所以上层组件不必知道数据来自服务端还是浏览器目录。
 *
 * 写操作（create / rename / remove / write）在后续阶段补在这里，不新开抽象层。
 */
import type { IEntry } from '@/types/server'
import { getMountedHandle, mountIdFromPath, relativePathInMount } from './mounted-volumes'

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
    // 代价是一次额外的磁盘 IO。与后端「拿不到就不编造」的取舍一致：
    // 置 0 / null，交给排序与属性窗口兜底。
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
  const root = await getMountedHandle(id)
  if (!root) {
    throw new MountedFsError('unknown-mount', `mounted volume not found: ${id}`)
  }

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

/** 去掉路径最后一段，得到父目录路径。 */
function parentPathOf(path: string, lastSegment: string): string {
  const cut = path.length - lastSegment.length - 1
  return cut > 0 ? path.slice(0, cut) : path
}

function toMountedFsError(error: unknown, label: string): MountedFsError {
  if (error instanceof MountedFsError) {
    return error
  }
  if (error instanceof DOMException) {
    // 名字不对（把文件当目录打开）与不存在，对调用方是同一件事：这个路径上没有目录
    if (error.name === 'NotFoundError' || error.name === 'TypeMismatchError') {
      return new MountedFsError('not-found', `not found in mounted folder: ${label}`)
    }
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new MountedFsError('permission', `permission denied: ${label}`)
    }
  }
  return new MountedFsError('not-found', `failed to read ${label}`)
}

/**
 * 读取一个卷内目录的子项。
 *
 * 文件按**串行**逐个 `getFile()` 取大小与修改时间：并发读几十上百个句柄会把磁盘
 * 打爆，而列表本来就只需要这些字段，串行也快过一帧。
 */
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
    // 这里的 `kind` 运行时一定是 'file'（上面两个分支已经排掉其余可能），
    // 但 lib.dom 里 `values()` 的联合类型不是可辨识联合，收不窄，只能显式断言
    const fileHandle = child as FileSystemFileHandle
    try {
      entries.push(fileEntry(await fileHandle.getFile()))
    }
    catch (error) {
      // 单个文件读不到（并发删除、权限收紧）不该让整个目录打不开：
      // 保留条目并把原因挂在条目上，与后端 IEntry.error 是同一个用法
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

/** 读取卷内一个文件的内容。 */
export async function readMountedFile(path: string): Promise<File> {
  const handle = await resolveMountedFileHandle(path)
  try {
    return await handle.getFile()
  }
  catch (error) {
    throw toMountedFsError(error, path)
  }
}

/**
 * 卷内文件的临时访问地址（objectURL）。
 *
 * 调用方负责在不再需要时 `URL.revokeObjectURL`——与 `use-image-preview.ts` 的
 * blob 生命周期约定一致。
 */
export async function mountedStreamUrl(path: string): Promise<string> {
  const file = await readMountedFile(path)
  return URL.createObjectURL(file)
}

/**
 * 创建（或复用）卷内目录。
 *
 * 与 `create-dir?ignoreExisted` 的后端语义对齐：已存在时按成功处理，
 * 因为复制一个目录树会反复声明同一个中间目录。
 */
export async function createMountedDir(path: string): Promise<void> {
  const name = lastPathSegment(path)
  if (!name) {
    return
  }
  const parent = await resolveMountedDirHandle(parentPathOf(path, name))
  // create 对已存在的目录是幂等的，不需要先探测一次
  await parent.getDirectoryHandle(name, { create: true })
}

/**
 * 在卷内某个目录下写一个文件，写入流由调用方提供。
 *
 * 返回最终使用的文件名：`keep-both` 冲突策略下会被改成 `name (1).ext`，
 * 调用方需要知道实际落点。
 */
export async function writeMountedFileFromStream(
  dirPath: string,
  filename: string,
  body: ReadableStream<Uint8Array>,
  options: { keepExistingData?: boolean } = {},
): Promise<void> {
  const dir = await resolveMountedDirHandle(dirPath)
  const writable = await (await dir.getFileHandle(filename, { create: true }))
    .createWritable({ keepExistingData: options.keepExistingData ?? false })

  try {
    await body.pipeTo(writable)
  }
  catch (error) {
    await writable.abort().catch(() => {})
    throw toMountedFsError(error, filename)
  }
}

/** 在卷内某个目录下创建（或覆盖）一个文件，内容由调用方提供。 */
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

/**
 * 删除卷内的一个文件或目录（目录递归删除）。
 *
 * 挂载根的删除会被浏览器拒绝（`removeEntry` 只能删子项），这里不做特殊兜底：
 * 失败会如实返回错误，比静默什么都不做更好。
 */
export async function removeMountedEntry(path: string): Promise<void> {
  const parent = await resolveMountedDirHandle(parentPathOf(path, lastPathSegment(path)))
  const name = lastPathSegment(path)
  if (!name) {
    throw new MountedFsError('not-found', 'refusing to remove the mounted root')
  }
  try {
    await parent.removeEntry(name, { recursive: true })
  }
  catch (error) {
    throw toMountedFsError(error, path)
  }
}

/** 卷内某个名字是否已被占用（冲突预检用）。 */
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

function lastPathSegment(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? ''
}
