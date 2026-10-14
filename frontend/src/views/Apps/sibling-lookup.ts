import { subscribeFsChanged } from '@/store/tasks'
import { fs } from '@/utils/fs'
import { joinPath, normalizeListingPath } from '@/utils/path/form'
import { pickSuffixedSibling, siblingFileCandidates } from './sibling-file'

/**
 * 找媒体文件旁边的同名字幕 / 歌词。
 *
 * 先看目录内容有没有缓存（命中就是纯本地判断，一个请求都不发——同一个歌单里换歌、
 * 同一个目录里换视频都走这里），没有才列一次目录，然后同时匹配两种名字：
 * 完全同名的 `movie.srt`，和带中缀的 `movie.chs.srt`（中缀长度不限，只能靠扫描）。
 *
 * 之所以不再先按候选路径问一次 `entry-queries`：一个目录里的每个媒体文件都要问一次，
 * 而列一次目录就能回答它们全部，缓存命中后更是零请求。任何失败都当「没有」返回：
 * 自动加载不该弹错误。
 */
export async function findSiblingFile(mediaPath: string, extensions: readonly string[]): Promise<string | undefined> {
  try {
    const slash = mediaPath.lastIndexOf('/')
    if (slash < 0)
      return undefined
    const dir = mediaPath.slice(0, slash) || '/'
    const names = cachedNames(dir) ?? await listNames(dir)
    return resolveSibling(dir, mediaPath.slice(slash + 1), names, extensions)
  }
  catch (error) {
    console.error('find sibling file failed', error)
    return undefined
  }
}

/** 从目录条目名里挑：完全同名（按扩展名顺序）优先，其次是带中缀的。 */
function resolveSibling(dir: string, mediaName: string, names: readonly string[], extensions: readonly string[]): string | undefined {
  const lowerNames = names.map(name => name.toLowerCase())
  for (const candidate of siblingFileCandidates(mediaName, extensions)) {
    const index = lowerNames.indexOf(candidate.toLowerCase())
    if (index >= 0)
      return joinPath(dir, names[index]!)
  }
  const suffixed = pickSuffixedSibling(mediaName, names, extensions)
  return suffixed ? joinPath(dir, suffixed) : undefined
}

/**
 * 目录条目缓存。
 *
 * 一个歌单里每首歌都会问一次「旁边有没有歌词」，没有歌词的话每首歌都得把整个目录列
 * 一遍。缓存整份名字表就没有这个问题。
 *
 * 失效和资源管理器的列表缓存一样，只靠服务端的 `fs.changed` 广播（新增、改名、删除、
 * 任务结束都会推；`fs.list` 过的目录服务端在监听），所以刚放进去的字幕马上能被看到，
 * 不需要 TTL 之类的兜底。
 */
const DIR_CACHE_MAX = 8
const dirCache = new Map<string, string[]>()

function cachedNames(dir: string): string[] | undefined {
  return dirCache.get(normalizeListingPath(dir))
}

async function listNames(dir: string): Promise<string[]> {
  const key = normalizeListingPath(dir)
  const names = (await fs.list(dir)).map(entry => entry.name)
  if (dirCache.size >= DIR_CACHE_MAX) {
    // Map 保持插入顺序，最早的目录最先被淘汰
    const oldest = dirCache.keys().next().value
    if (oldest)
      dirCache.delete(oldest)
  }
  dirCache.set(key, names)
  return names
}

// 目录变了就丢掉缓存；和资源管理器订阅的是同一条消息
subscribeFsChanged((paths, changes) => {
  for (const dir of paths)
    dirCache.delete(normalizeListingPath(dir))
  for (const change of changes)
    dirCache.delete(normalizeListingPath(change.dir))
})
