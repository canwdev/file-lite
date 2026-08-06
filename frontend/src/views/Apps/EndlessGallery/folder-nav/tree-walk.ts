import type { IEntry } from '@/types/server'
import { fsWebApi } from '@/api/filesystem'
import { localSettingsStore } from '@/store'
import { getPathSortMode } from '@/views/FileManager/ExplorerUI/explorer-state'
import { canGoUp, getLastDirName, getParentPath, normalizeListingPath } from '@/views/FileManager/utils'
import { sortEntries } from '@/views/FileManager/utils/sort'
import { getMediaType } from '../use-media-list'

/** 单次导航最多读取的目录数，避免在超大目录树上无限扫描 */
export const MAX_DIR_READS = 80

export type WalkDirection = 'next' | 'prev'

export interface MediaFolder {
  /** listing 形态路径（带尾斜杠），与资源管理器保持一致 */
  basePath: string
  /** 已按该路径的排序方式排序、并按 showHidden 过滤 */
  entries: IEntry[]
  /** entries 中的媒体文件，保持相同顺序 */
  mediaEntries: IEntry[]
}

export type WalkOutcome
  = ({ status: 'found' } & MediaFolder)
    | { status: 'boundary' | 'limit' | 'aborted' }

interface WalkContext {
  signal: AbortSignal
  /** 单次导航内的目录列表缓存，上翻时会反复读到同一父级 */
  cache: Map<string, IEntry[]>
  reads: number
  stopped: 'limit' | 'aborted' | null
}

async function readDir(ctx: WalkContext, path: string): Promise<IEntry[]> {
  const key = normalizeListingPath(path)
  const cached = ctx.cache.get(key)
  if (cached) {
    return cached
  }
  if (ctx.signal.aborted) {
    ctx.stopped = 'aborted'
    return []
  }
  if (ctx.reads >= MAX_DIR_READS) {
    ctx.stopped = 'limit'
    return []
  }

  ctx.reads += 1
  let list: IEntry[] = []
  try {
    list = (await fsWebApi.getList({ path: key }, { signal: ctx.signal, isToast: false })) || []
  }
  catch {
    if (ctx.signal.aborted) {
      ctx.stopped = 'aborted'
      return []
    }
    // 无权限等读取失败按空目录处理，继续扫描
  }

  const entries = sortEntries(list, getPathSortMode(key), localSettingsStore.value.showHidden)
  ctx.cache.set(key, entries)
  return entries
}

function subDirs(entries: IEntry[]): IEntry[] {
  return entries.filter(item => item.isDirectory)
}

function pickMedia(entries: IEntry[]): IEntry[] {
  return entries.filter(item => !item.isDirectory && !!getMediaType(item.name))
}

function toMediaFolder(basePath: string, entries: IEntry[]): MediaFolder | null {
  const mediaEntries = pickMedia(entries)
  return mediaEntries.length ? { basePath, entries, mediaEntries } : null
}

function childPath(parentPath: string, name: string): string {
  return normalizeListingPath(`${parentPath}/${name}`)
}

/** preorder：目录自身排在其子目录之前 */
async function firstInSubtree(ctx: WalkContext, path: string): Promise<MediaFolder | null> {
  if (ctx.stopped) {
    return null
  }
  const entries = await readDir(ctx, path)
  if (ctx.stopped) {
    return null
  }

  const self = toMediaFolder(path, entries)
  if (self) {
    return self
  }
  for (const dir of subDirs(entries)) {
    const hit = await firstInSubtree(ctx, childPath(path, dir.name))
    if (hit) {
      return hit
    }
    if (ctx.stopped) {
      return null
    }
  }
  return null
}

/** preorder 的逆序：子目录倒序在前，目录自身在后 */
async function lastInSubtree(ctx: WalkContext, path: string): Promise<MediaFolder | null> {
  if (ctx.stopped) {
    return null
  }
  const entries = await readDir(ctx, path)
  if (ctx.stopped) {
    return null
  }

  for (const dir of subDirs(entries).reverse()) {
    const hit = await lastInSubtree(ctx, childPath(path, dir.name))
    if (hit) {
      return hit
    }
    // 中断后不能退回本目录，否则会把浅层目录当成答案
    if (ctx.stopped) {
      return null
    }
  }
  return toMediaFolder(path, entries)
}

async function findNext(ctx: WalkContext, fromPath: string): Promise<MediaFolder | null> {
  // 先下钻当前目录的子树
  const ownEntries = await readDir(ctx, fromPath)
  for (const dir of subDirs(ownEntries)) {
    const hit = await firstInSubtree(ctx, childPath(fromPath, dir.name))
    if (hit) {
      return hit
    }
    if (ctx.stopped) {
      return null
    }
  }

  // 再逐级上翻，扫描后续兄弟的子树
  let node = fromPath
  while (canGoUp(node)) {
    const parentPath = getParentPath(node)
    const siblings = subDirs(await readDir(ctx, parentPath))
    if (ctx.stopped) {
      return null
    }

    const index = siblings.findIndex(item => item.name === getLastDirName(node))
    // 当前目录不在父级列表中（如被 showHidden 过滤）时跳过本层，避免重复扫描自身
    if (index > -1) {
      for (const dir of siblings.slice(index + 1)) {
        const hit = await firstInSubtree(ctx, childPath(parentPath, dir.name))
        if (hit) {
          return hit
        }
        if (ctx.stopped) {
          return null
        }
      }
    }
    node = parentPath
  }
  return null
}

async function findPrev(ctx: WalkContext, fromPath: string): Promise<MediaFolder | null> {
  let node = fromPath
  while (canGoUp(node)) {
    const parentPath = getParentPath(node)
    const parentEntries = await readDir(ctx, parentPath)
    if (ctx.stopped) {
      return null
    }

    const siblings = subDirs(parentEntries)
    const index = siblings.findIndex(item => item.name === getLastDirName(node))
    if (index > -1) {
      for (const dir of siblings.slice(0, index).reverse()) {
        const hit = await lastInSubtree(ctx, childPath(parentPath, dir.name))
        if (hit) {
          return hit
        }
        if (ctx.stopped) {
          return null
        }
      }
    }

    // 父目录自身排在其子目录之前
    const parentFolder = toMediaFolder(parentPath, parentEntries)
    if (parentFolder) {
      return parentFolder
    }
    node = parentPath
  }
  return null
}

/**
 * 在文件夹树中按 preorder（prev 为其逆序）查找下一个含媒体的目录。
 * 单向推进不回环，上翻至 `canGoUp` 为 false 为止，因此一定会终止。
 */
export async function walkToMediaFolder(
  fromPath: string,
  direction: WalkDirection,
  signal: AbortSignal,
): Promise<WalkOutcome> {
  const ctx: WalkContext = { signal, cache: new Map(), reads: 0, stopped: null }
  const startPath = normalizeListingPath(fromPath)

  const hit = direction === 'next'
    ? await findNext(ctx, startPath)
    : await findPrev(ctx, startPath)

  if (hit) {
    return { status: 'found', ...hit }
  }
  return { status: ctx.stopped ?? 'boundary' }
}
