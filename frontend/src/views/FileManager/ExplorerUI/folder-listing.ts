/**
 * 目录子项读取 + 会话内缓存。
 *
 * 供文件夹内容预览（ThemedIcon）与面包屑下拉（AddressBar）共享，
 * 语义与主列表一致：原始列表按「目标目录自身的排序规则 + showHidden」
 * 整理（见 applyFolderListSort / sortEntries）。
 */
import type { IEntry } from '@/types/server'
import { fsWebApi } from '@/api/filesystem'
import { localSettingsStore } from '@/store'
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
    const list = await fsWebApi.getList({ path }, { isToast: false })
    return Array.isArray(list) ? (list as IEntry[]) : []
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

  const task = new Promise<IEntry[]>((resolve) => {
    readQueue.push(() => {
      fetchRawList(key)
        .then((list) => {
          rawCache.set(key, list)
          readOk.set(key, true)
          trimRawCache()
          resolve(list)
        })
        .finally(() => {
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
  return sortEntries(rawList, getPathSortMode(key), localSettingsStore.value.showHidden)
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
  rawCache.set(key, entries)
  readOk.set(key, true)
  trimRawCache()
}

/** 失效缓存；不带参数清空全部 */
export function clearFolderListingCache(path?: string): void {
  if (path === undefined) {
    rawCache.clear()
    readOk.clear()
    return
  }
  const key = normalizeListingPath(path)
  rawCache.delete(key)
  readOk.delete(key)
}
