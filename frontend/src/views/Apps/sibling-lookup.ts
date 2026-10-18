import type { IEntry } from '@/types/server'
import { subscribeFsChanged } from '@/store/tasks'
import { fs } from '@/utils/fs'
import { joinPath, normalizeListingPath } from '@/utils/path/form'
import { pickSuffixedSiblings, siblingFileCandidates } from './sibling-file'

/**
 * 常见的字幕目录名（小写比较）。
 *
 * 有的电影库把字幕集中放在电影目录下的 `SRT/`、`Subs/` 或 `字幕/` 里，文件名仍然
 * 带着电影名；这时只扫视频所在目录是找不到字幕的。
 */
export const SUBTITLE_DIR_NAMES = [
  'srt',
  'ass',
  'subs',
  'subtitles',
  'sub',
  'subtitle',
  '字幕',
  '外挂字幕',
  '字幕文件',
]

/**
 * 找媒体文件旁边的同名字幕 / 歌词（只要一个）。
 *
 * 只扫媒体文件所在目录：歌词和字幕不同，一首歌只该有一份同名歌词，没有集中放在别处的约定。
 */
export async function findSiblingFile(mediaPath: string, extensions: readonly string[]): Promise<string | undefined> {
  return (await findSiblingFiles(mediaPath, extensions))[0]
}

/**
 * 找同目录（以及给定的常见子目录，例如 `SRT/`）里所有匹配的媒体文件。
 *
 * 先看目录内容有没有缓存（命中就是纯本地判断，一个请求都不发——同一个歌单里换歌、
 * 同一个目录里换视频都走这里），没有才列一次目录，然后同时匹配两种名字：
 * 完全同名的 `movie.srt`，和带中缀的 `movie.chs.srt`（中缀长度不限，只能靠扫描）。
 *
 * 返回顺序：视频所在目录优先，同目录里完全同名优先、其余按 `pickSuffixedSiblings`
 * 的语言/扩展名顺序。任何失败都当「没有」返回：自动加载不该弹错误。
 */
export async function findSiblingFiles(
  mediaPath: string,
  extensions: readonly string[],
  subdirNames: readonly string[] = [],
): Promise<string[]> {
  const parts = splitMediaPath(mediaPath)
  if (!parts)
    return []

  try {
    const entries = cachedEntries(parts.dir) ?? await listEntries(parts.dir)
    const found = resolveSiblings(parts.dir, parts.name, entries, extensions)
    if (!subdirNames.length)
      return found

    const wanted = new Set(subdirNames.map(name => name.toLowerCase()))
    for (const entry of entries) {
      if (!entry.isDirectory || !wanted.has(entry.name.toLowerCase()))
        continue
      const subdir = joinPath(parts.dir, entry.name)
      try {
        const subEntries = cachedEntries(subdir) ?? await listEntries(subdir)
        found.push(...resolveSiblings(subdir, parts.name, subEntries, extensions))
      }
      catch (error) {
        // 字幕子目录可能没有权限；不影响视频目录里已经找到的字幕
        console.error('find sibling files in subdirectory failed', error)
      }
    }
    return found
  }
  catch (error) {
    console.error('find sibling files failed', error)
    return []
  }
}

/** 拆出所在目录与文件名；盘符根 `K:/x` 的目录是 `K:/` 而不是 `K:`。 */
function splitMediaPath(path: string): { dir: string, name: string } | null {
  const slash = path.lastIndexOf('/')
  if (slash < 0)
    return null
  const name = path.slice(slash + 1)
  if (!name)
    return null
  const parent = path.slice(0, slash)
  const dir = /^[a-z]:$/i.test(parent) ? `${parent}/` : (parent || '/')
  return { dir, name }
}

/** 从目录条目里挑：完全同名（按扩展名顺序）优先，其次是带中缀的。 */
function resolveSiblings(dir: string, mediaName: string, entries: readonly IEntry[], extensions: readonly string[]): string[] {
  const files = entries.filter(entry => !entry.isDirectory)
  const names = files.map(entry => entry.name)
  const byLowerName = new Map(files.map(entry => [entry.name.toLowerCase(), entry.name]))

  const exact: string[] = []
  for (const candidate of siblingFileCandidates(mediaName, extensions)) {
    const name = byLowerName.get(candidate.toLowerCase())
    if (name)
      exact.push(name)
  }
  const suffixed = pickSuffixedSiblings(mediaName, names, extensions)
  return [...exact, ...suffixed].map(name => joinPath(dir, name))
}

/**
 * 目录条目缓存。
 *
 * 一个歌单里每首歌都会问一次「旁边有没有歌词」，没有歌词的话每首歌都得把整个目录列
 * 一遍。缓存整份列表就没有这个问题；字幕子目录也要靠同一份列表发现，所以缓存的是
 * 条目而不是名字。
 *
 * 失效和资源管理器的列表缓存一样，只靠服务端的 `fs.changed` 广播（新增、改名、删除、
 * 任务结束都会推；`fs.list` 过的目录服务端在监听），所以刚放进去的字幕马上能被看到，
 * 不需要 TTL 之类的兜底。
 */
const DIR_CACHE_MAX = 8
const dirCache = new Map<string, IEntry[]>()

function cachedEntries(dir: string): IEntry[] | undefined {
  return dirCache.get(normalizeListingPath(dir))
}

async function listEntries(dir: string): Promise<IEntry[]> {
  const key = normalizeListingPath(dir)
  const entries = await fs.list(dir)
  if (dirCache.size >= DIR_CACHE_MAX) {
    // Map 保持插入顺序，最早的目录最先被淘汰
    const oldest = dirCache.keys().next().value
    if (oldest)
      dirCache.delete(oldest)
  }
  dirCache.set(key, entries)
  return entries
}

// 目录变了就丢掉缓存；和资源管理器订阅的是同一条消息
subscribeFsChanged((paths, changes) => {
  for (const dir of paths)
    dirCache.delete(normalizeListingPath(dir))
  for (const change of changes)
    dirCache.delete(normalizeListingPath(change.dir))
})
