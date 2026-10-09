/**
 * 目录子项读取 + 会话内缓存。
 *
 * 供文件夹内容预览（ThemedIcon）与面包屑下拉（AddressBar）共享，
 * 语义与主列表一致：原始列表按「目标目录自身的排序规则 + showHidden」
 * 整理（见 applyFolderListSort / sortEntries）。
 */
import type { FsDirChange, IEntry } from '@/types/server'
import { reactive } from 'vue'
import { localSettingsStore } from '@/store'
import { subscribeFsChanged } from '@/store/tasks'
import { fs } from '@/utils/fs'
import { normalizeListingPath } from '../utils'
import { sortEntries } from '../utils/sort'
import { getPathSortMode } from './explorer-state'

/** 同时进行的目录读取数，避免大目录网格首屏打爆服务端 */
const MAX_CONCURRENT_READS = 4
/** 缓存条目上限，超出后按最旧淘汰 */
const MAX_CACHE_ENTRIES = 200

const rawCache = new Map<string, IEntry[]>()
/** 目录是否读取成功（读取失败按空目录处理时，消费方可据此区分「失败」与「确实为空」） */
const readOk = new Map<string, boolean>()
const inflightReads = new Map<string, Promise<IEntry[]>>()
/**
 * 每个目录的失效计数。读取开始时记下，返回时若已变化，说明读取期间目录改过，
 * 这份结果可能是旧的：照样交给调用方，但不写缓存。
 */
const generations = new Map<string, number>()
/**
 * 目录内容变化的版本号（响应式）。缓存被补丁或失效后 +1，
 * 正在展示该目录预览的组件据此重新读取。
 */
const listingVersions = reactive(new Map<string, number>())

let activeReadCount = 0
const readQueue: Array<() => void> = []

function pumpReadQueue() {
  while (activeReadCount < MAX_CONCURRENT_READS && readQueue.length) {
    const start = readQueue.shift()!
    activeReadCount += 1
    start()
  }
}

function finishRead() {
  activeReadCount = Math.max(0, activeReadCount - 1)
  pumpReadQueue()
}

async function fetchRawList(path: string): Promise<IEntry[]> {
  try {
    // 走门面而不是直接调 `/api/fs/directories`：列表读取只有一个入口。
    return await fs.list(path)
  }
  catch {
    // 无权限等读取失败按空目录处理，与 EndlessGallery 的 tree-walk 一致
    return []
  }
}

function trimRawCache() {
  while (rawCache.size > MAX_CACHE_ENTRIES) {
    const oldest = rawCache.keys().next().value as string | undefined
    if (oldest === undefined)
      break
    rawCache.delete(oldest)
  }
}

/**
 * 读取某目录的原始列表（带缓存与并发限制）。
 * 仅缓存原始数据，排序/隐藏过滤在消费时按当时设置进行。
 */
export function readFolderRawList(path: string, opts: { force?: boolean } = {}): Promise<IEntry[]> {
  const key = normalizeListingPath(path)
  const cached = rawCache.get(key)
  if (cached && !opts.force) {
    return Promise.resolve(cached)
  }
  const inflight = inflightReads.get(key)
  if (inflight && !opts.force) {
    return inflight
  }

  const generation = generations.get(key) ?? 0
  const task = new Promise<IEntry[]>((resolve) => {
    readQueue.push(() => {
      fetchRawList(key)
        .then((list) => {
          if ((generations.get(key) ?? 0) === generation) {
            rawCache.set(key, list)
            readOk.set(key, true)
            trimRawCache()
          }
          resolve(list)
        })
        .finally(() => {
          if (inflightReads.get(key) === task)
            inflightReads.delete(key)
          finishRead()
        })
    })
    pumpReadQueue()
  })
  inflightReads.set(key, task)
  return task
}

/** 按目标目录自身的排序与隐藏文件设置整理一份原始列表 */
export function applyFolderListSort(path: string, rawList: IEntry[]): IEntry[] {
  const key = normalizeListingPath(path)
  return sortEntries(
    rawList,
    getPathSortMode(key),
    localSettingsStore.value.showHidden,
    localSettingsStore.value.sortFoldersFirst,
  )
}

/** 已缓存目录的排序结果；未缓存返回空数组且不会发起请求 */
export function getSortedFolderEntries(path: string): IEntry[] {
  const raw = rawCache.get(normalizeListingPath(path))
  return raw ? applyFolderListSort(path, raw) : []
}

/** 该目录最近一次读取是否成功 */
export function wasFolderListingOk(path: string): boolean {
  return readOk.get(normalizeListingPath(path)) ?? false
}

/** 把刚加载完成的主列表写入缓存，保证该目录的预览/下拉内容新鲜 */
export function seedFolderListing(path: string, entries: IEntry[]): void {
  const key = normalizeListingPath(path)
  bumpGeneration(key)
  rawCache.set(key, entries)
  readOk.set(key, true)
  trimRawCache()
}

/** 目录内容变化的版本号；在 computed / watch 里读取即可在目录变化后收到通知 */
export function getFolderListingVersion(path: string): number {
  return listingVersions.get(normalizeListingPath(path)) ?? 0
}

function bumpGeneration(key: string) {
  generations.set(key, (generations.get(key) ?? 0) + 1)
}

function bumpListingVersion(key: string) {
  listingVersions.set(key, (listingVersions.get(key) ?? 0) + 1)
}

/** 丢掉缓存与在途读取，下次读取重新请求 */
function invalidateListing(key: string) {
  bumpGeneration(key)
  rawCache.delete(key)
  readOk.delete(key)
  inflightReads.delete(key)
  bumpListingVersion(key)
}

/** 有缓存就按条目级变化原地改，否则只能失效 */
function patchListing(key: string, change: FsDirChange) {
  const cached = rawCache.get(key)
  if (!cached || inflightReads.has(key)) {
    invalidateListing(key)
    return
  }
  const byName = new Map(cached.map(entry => [entry.name, entry]))
  for (const name of change.removed ?? [])
    byName.delete(name)
  for (const entry of [...(change.added ?? []), ...(change.updated ?? [])])
    byName.set(entry.name, entry)
  bumpGeneration(key)
  rawCache.set(key, [...byName.values()])
  bumpListingVersion(key)
}

/** 被删除 / 改名 / 移走的子目录：它自己与其下所有缓存都已不再对应磁盘内容 */
function invalidateSubtree(prefix: string) {
  const keys = new Set([...rawCache.keys(), ...inflightReads.keys(), ...listingVersions.keys()])
  for (const key of keys) {
    if (key.startsWith(prefix))
      invalidateListing(key)
  }
}

// 服务端广播的目录变化（上传、新建、重命名、删除、任务结束）：
// 带 changes 的目录原地打补丁，只有 paths 的目录整份失效。
// 主列表也订阅了同一条消息（use-navigation），两边谁先处理都不影响结果：
// 补丁按名字 upsert，是幂等的。
subscribeFsChanged((paths, changes) => {
  const patched = new Set<string>()
  for (const change of changes) {
    const key = normalizeListingPath(change.dir)
    patched.add(key)
    patchListing(key, change)
    for (const name of change.removed ?? [])
      invalidateSubtree(normalizeListingPath(`${key}${name}`))
  }
  for (const path of paths) {
    const key = normalizeListingPath(path)
    if (!patched.has(key))
      invalidateListing(key)
  }
})
