/**
 * 浏览器挂载的本地文件夹（虚拟驱动器）。
 *
 * 与后端驱动器（`drives.ts`）的关键区别：它的内容在**浏览器里**，后端只看到一条
 * 它解析不了的路径。所以这里只做三件事——保存句柄、维护侧边栏列表、给出路径前缀；
 * 真正的读写由 `browser-fs.ts` 负责。
 *
 * 路径命名空间是 `/@mounted/<id>`：字符串化，后端永远不该收到它（收到就是没被
 * `isMountedPath` 拦下，会得到一次明确的 400/403，而不是静默操作错位置）。
 */
import { openDB } from 'idb'
import { ref } from 'vue'
import { normalizeListingPath } from '../utils/path-form'

/** 挂载点在本应用路径空间里的前缀（canonical 无尾斜杠形态）。 */
export const MOUNTED_PATH_PREFIX = '/@mounted'

/** 句柄持久化用的 IndexedDB；与缩略图缓存分开，避免互相升级阻塞。 */
const DB_NAME = 'file-lite-browser-mounts'
const DB_VERSION = 1
const STORE = 'volumes'

/** 挂载项的持久化元数据（不含句柄：句柄单独存同一个 record 的值里）。 */
export interface MountedVolumeMeta {
  id: string
  label: string
  addedAt: number
}

/**
 * 访问授权状态。
 *
 * `prompt` 是正常态而非错误：句柄能跨刷新恢复，但权限要在用户手势里再确认一次。
 * `denied` 单独分出来是因为它需要不同的出路（重新挂载 / 卸载），而不是再弹一次。
 */
export type MountedVolumeAccess = 'granted' | 'prompt' | 'denied'

export interface MountedVolume extends MountedVolumeMeta {
  access: MountedVolumeAccess
}

/** 浏览器是否支持 File System Access API。非 Chromium 一律不支持，挂载区整块隐藏。 */
export function isMountSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

/** 已挂载卷列表（侧边栏消费）。 */
export const mountedVolumes = ref<MountedVolume[]>([])

/** 首次恢复是否已完成：未完成前不要给「没有挂载」的空态。 */
export const mountedVolumesLoaded = ref(false)

export const mountedVolumesLoading = ref(false)

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

/** `<id>` 只允许自己生成的形态，避免路径里出现段分隔符导致解析歧义。 */
const ID_PATTERN = /^[a-z0-9]+$/i

/** 一个卷的根路径（listing 形态，带结尾斜杠）。 */
export function mountRootPath(id: string): string {
  return `${MOUNTED_PATH_PREFIX}/${id}/`
}

/** 路径归一化成 listing 形态再去掉尾斜杠，用于取段。 */
function segmentsOf(path: string): string {
  const normalized = normalizeListingPath(path)
  return normalized === '/' ? '' : normalized.replace(/\/+$/, '')
}

/** 该路径是否属于浏览器挂载命名空间。 */
export function isMountedPath(path: string | null | undefined): boolean {
  if (!path) {
    return false
  }
  const normalized = normalizeListingPath(path)
  return normalized === `${MOUNTED_PATH_PREFIX}/` || normalized.startsWith(`${MOUNTED_PATH_PREFIX}/`)
}

/** 从路径里取出挂载 id；不是挂载路径、或 id 形态非法时返回 null。 */
export function mountIdFromPath(path: string | null | undefined): string | null {
  if (!path || !isMountedPath(path)) {
    return null
  }
  const id = segmentsOf(path).slice(MOUNTED_PATH_PREFIX.length + 1).split('/')[0] ?? ''
  return ID_PATTERN.test(id) ? id : null
}

/** 挂载根之下的相对路径（`a/b`，根为空串）；路径不属于该卷时返回 null。 */
export function relativePathInMount(path: string, id: string): string | null {
  const normalized = segmentsOf(path)
  const prefix = `${MOUNTED_PATH_PREFIX}/${id}`
  if (normalized === prefix) {
    return ''
  }
  if (!normalized.startsWith(`${prefix}/`)) {
    return null
  }
  return normalized.slice(prefix.length + 1)
}

/** 由挂载点路径构造卷根路径；不是挂载路径时原样返回。 */
export function mountRootOfPath(path: string): string {
  const id = mountIdFromPath(path)
  return id ? mountRootPath(id) : path
}

function newVolumeId(): string {
  const bytes = new Uint8Array(6)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  }
  else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// 句柄持久化
// ---------------------------------------------------------------------------

interface VolumeRecord {
  meta: MountedVolumeMeta
  handle: FileSystemDirectoryHandle
}

/**
 * 句柄 → IndexedDB 的读写入口。
 *
 * IndexedDB 不可用时（隐私模式、被策略禁用）退化成内存 Map，避免整个挂载功能
 * 因为持久化层而完全不可用——代价只是刷新后要重新挂载。
 */
function createHandleStore() {
  let dbPromise: ReturnType<typeof openDB> | null = null
  const memory = new Map<string, VolumeRecord>()

  function db() {
    if (!dbPromise) {
      dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(STORE)) {
            database.createObjectStore(STORE, { keyPath: 'meta.id' })
          }
        },
      })
    }
    return dbPromise
  }

  async function readAll(): Promise<VolumeRecord[]> {
    try {
      return (await (await db()).getAll(STORE)) as VolumeRecord[]
    }
    catch (error) {
      console.error('[mounted-volumes] failed to read handles', error)
      return [...memory.values()]
    }
  }

  async function read(id: string): Promise<VolumeRecord | null> {
    try {
      return ((await (await db()).get(STORE, id)) as VolumeRecord | undefined) ?? memory.get(id) ?? null
    }
    catch (error) {
      console.error('[mounted-volumes] failed to read handle', error)
      return memory.get(id) ?? null
    }
  }

  async function write(record: VolumeRecord): Promise<void> {
    memory.set(record.meta.id, record)
    try {
      await (await db()).put(STORE, record)
    }
    catch (error) {
      console.error('[mounted-volumes] failed to persist handle', error)
    }
  }

  async function remove(id: string): Promise<void> {
    memory.delete(id)
    try {
      await (await db()).delete(STORE, id)
    }
    catch (error) {
      console.error('[mounted-volumes] failed to remove handle', error)
    }
  }

  return { readAll, read, write, remove }
}

const handleStore = createHandleStore()

// 句柄也留一份内存副本：导航一次要连续穿几层目录，不该每层都读一次 IndexedDB。
const handleCache = new Map<string, FileSystemDirectoryHandle>()

/** 取某个卷的目录句柄（内存命中优先，否则读持久化层）。 */
export async function getMountedHandle(id: string): Promise<FileSystemDirectoryHandle | null> {
  const cached = handleCache.get(id)
  if (cached) {
    return cached
  }
  const record = await handleStore.read(id)
  if (!record) {
    return null
  }
  handleCache.set(id, record.handle)
  return record.handle
}

// ---------------------------------------------------------------------------
// 权限
// ---------------------------------------------------------------------------

interface PermissionCapableHandle {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
}

/**
 * 读权限状态；拿不到 API 时按 `granted` 处理。
 *
 * 有些实现不带 `queryPermission`，此时谎报 `prompt` 会让每次刷新都要求用户再点一次，
 * 反而不如直接放行、让真正的读写去失败。
 */
export async function queryVolumePermission(handle: FileSystemDirectoryHandle): Promise<MountedVolumeAccess> {
  const capable = handle as unknown as PermissionCapableHandle
  if (typeof capable.queryPermission !== 'function') {
    return 'granted'
  }
  try {
    return await capable.queryPermission({ mode: 'read' }) as MountedVolumeAccess
  }
  catch (error) {
    console.error('[mounted-volumes] queryPermission failed', error)
    return 'denied'
  }
}

/** 在用户手势里申请读权限。 */
export async function requestVolumePermission(handle: FileSystemDirectoryHandle): Promise<MountedVolumeAccess> {
  const capable = handle as unknown as PermissionCapableHandle
  if (typeof capable.requestPermission !== 'function') {
    return 'granted'
  }
  try {
    return await capable.requestPermission({ mode: 'read' }) as MountedVolumeAccess
  }
  catch (error) {
    console.error('[mounted-volumes] requestPermission failed', error)
    return 'denied'
  }
}

// ---------------------------------------------------------------------------
// 列表装载
// ---------------------------------------------------------------------------

function toVolume(record: VolumeRecord, access: MountedVolumeAccess): MountedVolume {
  return { ...record.meta, access }
}

/**
 * 从 IndexedDB 恢复已挂载卷。
 *
 * **不申请权限**——恢复发生在页面加载时，没有用户手势，`requestPermission` 会直接
 * 被拒。能静默确认到 `granted` 的按可用处理，其余标记为 `prompt`，由侧边栏
 * 显示「需要授权」，用户点一次再走 `requestVolumePermission`。
 */
export async function loadMountedVolumes(): Promise<MountedVolume[]> {
  if (!isMountSupported()) {
    mountedVolumes.value = []
    mountedVolumesLoaded.value = true
    return []
  }

  mountedVolumesLoading.value = true
  try {
    let records: VolumeRecord[] = []
    try {
      records = await handleStore.readAll()
    }
    catch (error) {
      // 持久化层不可用不该让整块挂载区卡在「加载中」：当作没有挂载卷，
      // 用户仍然可以当场挂一个新的
      console.error('[mounted-volumes] failed to restore mounts', error)
    }
    const entries = await Promise.all(records.map(async (record) => {
      handleCache.set(record.meta.id, record.handle)
      return toVolume(record, await queryVolumePermission(record.handle))
    }))
    entries.sort((a, b) => a.addedAt - b.addedAt)
    mountedVolumes.value = entries
  }
  finally {
    mountedVolumesLoading.value = false
    mountedVolumesLoaded.value = true
  }
  return mountedVolumes.value
}

/**
 * 一次性恢复全部待授权卷。
 *
 * 只对**已经指向 `prompt` 的卷**发起 `requestPermission`，而且在同一个 tick 里
 * 全部发起、之后才 `await`：弹窗必须落在用户手势的有效期内，逐个 await 会让
 * 后面的调用失去手势。任何一次拒绝都只会让那一个卷保持 `prompt`，不影响其他卷。
 */
export async function requestAllMountedVolumes(): Promise<void> {
  const pending = mountedVolumes.value.filter(volume => volume.access === 'prompt')
  if (!pending.length) {
    return
  }

  const handles = await Promise.all(pending.map(volume => getMountedHandle(volume.id)))
  const requests = handles.map(handle => (handle ? requestVolumePermission(handle) : Promise.resolve<MountedVolumeAccess>('denied')))
  const results = await Promise.all(requests)

  const accessById = new Map(pending.map((volume, index) => [volume.id, results[index] ?? 'denied']))
  mountedVolumes.value = mountedVolumes.value.map(volume =>
    accessById.has(volume.id) ? { ...volume, access: accessById.get(volume.id)! } : volume,
  )
}

/**
 * 给单个卷申请权限并回写状态。
 * 返回更新后的状态；调用方据此决定是导航进去还是提示。
 */
export async function grantMountedVolume(id: string): Promise<MountedVolumeAccess | null> {
  const handle = await getMountedHandle(id)
  if (!handle) {
    return null
  }
  const access = await requestVolumePermission(handle)
  mountedVolumes.value = mountedVolumes.value.map(volume =>
    volume.id === id ? { ...volume, access } : volume,
  )
  return access
}

// ---------------------------------------------------------------------------
// 挂载 / 卸载
// ---------------------------------------------------------------------------

/** `showDirectoryPicker` 的取消（AbortError）不是错误，调用方按「用户放弃」处理。 */
export function isPickerCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * 挂载一个浏览器文件夹。必须在用户手势里调用（内部直接弹系统选择框）。
 * 返回新挂载的卷；用户取消时返回 null。
 */
export async function mountBrowserFolder(): Promise<MountedVolume | null> {
  if (!isMountSupported()) {
    return null
  }

  const handle = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker({ mode: 'readwrite' })

  const record: VolumeRecord = {
    meta: {
      id: newVolumeId(),
      // 目录名可能为空串（某些根目录），退回一个稳定但不误导的名字
      label: handle.name || 'Mounted folder',
      addedAt: Date.now(),
    },
    handle,
  }

  await handleStore.write(record)
  handleCache.set(record.meta.id, handle)

  // 刚拿到手的句柄必然是可读的，不用再查一次
  const volume: MountedVolume = { ...record.meta, access: 'granted' }
  mountedVolumes.value = [...mountedVolumes.value, volume]
  mountedVolumesLoaded.value = true
  return volume
}

/** 取消挂载：只删本地记录，不碰磁盘上的任何文件。 */
export async function unmountBrowserFolder(id: string): Promise<void> {
  await handleStore.remove(id)
  handleCache.delete(id)
  mountedVolumes.value = mountedVolumes.value.filter(volume => volume.id !== id)
}

// ---------------------------------------------------------------------------
// 侧边栏接入
// ---------------------------------------------------------------------------

/** 卷根路径（listing 形态），侧边栏高亮与导航都用它。 */
export function mountedVolumeListingPath(id: string): string {
  return normalizeListingPath(mountRootPath(id))
}

/**
 * 挂载卷的**导航边界**（listing 形态），供 `utils/index.ts` 的 `canGoUp` /
 * `getParentPath` / 面包屑使用。
 *
 * 它**不并进** `drives.ts` 的 `driveList`：那份列表同时是后端跨卷判定
 * （移动 / 复制）的输入，一条后端解析不了的路径混进去会让拖拽选错模式。
 * 边界列表只服务导航，两者读同一份挂载数据但用途不同。
 */
export function mountedVolumeBoundaryPaths(): readonly string[] {
  const source = mountedVolumes.value
  if (source === cachedBoundarySource) {
    return cachedBoundaryPaths
  }
  cachedBoundarySource = source
  cachedBoundaryPaths = source.map(volume => mountedVolumeListingPath(volume.id))
  return cachedBoundaryPaths
}

/** 按源数组引用缓存：路径数组在导航里每次按键都会被读，不能重算整张表。 */
let cachedBoundaryPaths: string[] = []
let cachedBoundarySource: MountedVolume[] = []
