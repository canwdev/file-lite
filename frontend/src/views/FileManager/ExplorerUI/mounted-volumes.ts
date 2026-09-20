/**
 * 浏览器挂载的本地文件夹（虚拟驱动器）。
 *
 * 挂载走的是 **File System Access API**：`showDirectoryPicker()` 让用户挑一个磁盘上
 * 真实的文件夹，交回 `FileSystemDirectoryHandle`。它与 **OPFS**
 * （`navigator.storage.getDirectory()`）只是共用句柄类型，并不是一回事——OPFS 是源私有、
 * 用户看不见的沙箱存储，本功能不使用它；项目里只有 e2e 拿 OPFS 给目录选择框打桩。
 *
 * 与后端驱动器（`drives.ts`）的关键区别：它的内容在**浏览器里**，后端只看到一条
 * 它解析不了的路径。所以这里只做三件事——保存句柄、维护侧边栏列表、给出路径前缀；
 * 真正的读写由 `utils/fs/browser-backend.ts` 负责。
 *
 * 路径命名空间是 `/@mounted/<id>`：字符串化，后端永远不该收到它（收到就是没被
 * `isMountedPath` 拦下，会得到一次明确的 400/403，而不是静默操作错位置）。
 */
import { openDB } from 'idb'
import { ref } from 'vue'
import { setMountedHandleResolver, setMountedWriteFailureReporter, setMountedWriteGuard } from '../../../utils/fs/browser-backend'
import { mountIdFromPath, mountRootPath, normalizeListingPath } from '../../../utils/fs/paths'
import { mountedWriteGuard, reportMountedWriteFailure } from './mount-write'

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
 *
 * `read-only` 与 `granted`（= 读写）分开，是因为浏览器完全允许「只读重连」：
 * 用户可能只批了读、或当初就是只读挂载的。这类卷能浏览但写不了，界面必须
 * 提前说清楚，而不是等用户点了新建才弹一个「权限不足」。
 */
export type MountedVolumeAccess = 'granted' | 'read-only' | 'prompt' | 'denied'

/** 该访问状态能不能写。 */
export function canWriteVolume(access: MountedVolumeAccess): boolean {
  return access === 'granted'
}

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
// 共享层的浏览器后端只做字节搬运；句柄与「能不能写」都由这里注入
// （挂载表才是句柄缓存与授权状态的持有者）
setMountedHandleResolver(getMountedHandle)
setMountedWriteGuard(mountedWriteGuard)
setMountedWriteFailureReporter(reportMountedWriteFailure)

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
 * 查询当前的访问状态。
 *
 * 先问 `readwrite` 再退回 `read`：**必须按写的权限去问**，否则一个只批了读的句柄
 * 会被判成「可用」，用户点新建/重命名时才失败。反过来，重连时只拿到读权限是
 * 正常结果（用户只批了读），按 `read-only` 如实上报，界面据此降级。
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
    if (await capable.queryPermission({ mode: 'readwrite' }) === 'granted') {
      return 'granted'
    }
    if (await capable.queryPermission({ mode: 'read' }) === 'granted') {
      return 'read-only'
    }
    return 'prompt'
  }
  catch (error) {
    console.error('[mounted-volumes] queryPermission failed', error)
    return 'denied'
  }
}

/**
 * 在用户手势里申请读写权限。
 *
 * 写操作需要 `readwrite`，所以这里直接要它；被拒时**退回只读**而不是整块判死——
 * 用户可能只是不想给写权限，浏览仍然应该可用。
 */
export async function requestVolumePermission(handle: FileSystemDirectoryHandle): Promise<MountedVolumeAccess> {
  const capable = handle as unknown as PermissionCapableHandle
  if (typeof capable.requestPermission !== 'function') {
    return 'granted'
  }
  try {
    if (await capable.requestPermission({ mode: 'readwrite' }) === 'granted') {
      return 'granted'
    }
    if (await capable.queryPermission?.({ mode: 'read' }) === 'granted') {
      return 'read-only'
    }
    return 'prompt'
  }
  catch (error) {
    console.error('[mounted-volumes] requestPermission failed', error)
    return 'denied'
  }
}

/**
 * 写操作被浏览器拒绝后，把卷的状态降级。
 *
 * 权限可能在挂载之后被用户在浏览器设置里收回，或只读目录（如系统目录）根本
 * 写不进去；此时把状态改成 `read-only`，界面下一帧就会提示需要重新授权，
 * 而不是每次写都弹一次失败。
 */
export function downgradeVolumeToReadOnly(id: string): void {
  mountedVolumes.value = mountedVolumes.value.map(volume =>
    volume.id === id && volume.access === 'granted' ? { ...volume, access: 'read-only' } : volume,
  )
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
 * 只对**还没拿到读写权限的卷**（`prompt` 与 `read-only`）发起 `requestPermission`，
 * 而且在同一个 tick 里全部发起、之后才 `await`：弹窗必须落在用户手势的有效期内，
 * 逐个 await 会让后面的调用失去手势。任何一次拒绝都只会让那一个卷保持原状，
 * 不影响其他卷。
 */
export async function requestAllMountedVolumes(): Promise<void> {
  // `read-only` 也算「可以再问一次」：用户当时可能只批了读，点这里就是补写权限
  const pending = mountedVolumes.value.filter(volume => volume.access === 'prompt' || volume.access === 'read-only')
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

  // 选择框是按读写申请的，但用户完全可能只批了读（或选中的是只读目录）。
  // 必须真查一次，否则界面会把一个写不了的卷显示成可写，等到用户新建文件才失败。
  const volume: MountedVolume = { ...record.meta, access: await queryVolumePermission(handle) }
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

/**
 * 一条挂载卷路径对应的显示名（卷标）。
 *
 * 面包屑第一段拿的是**导航边界**的路径字符串；对挂载卷来说那就是
 * `/@mounted/<id>/`，直接显示出来毫无意义。所以那个位置需要回头查一次卷标。
 * 找不到（卷已被卸载）时返回 null，调用方退回原字符串。
 */
export function mountedVolumeLabelForPath(path: string | null | undefined): string | null {
  const id = mountIdFromPath(path)
  if (!id) {
    return null
  }
  return mountedVolumes.value.find(volume => volume.id === id)?.label ?? null
}

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
