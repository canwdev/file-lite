import type { IEntry } from '@/types/server'
import { joinPath, normalizeListingPath } from '@/utils/path/form'
import { readFolderRawList } from '@/views/FileManager/ExplorerUI/folder-listing'
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

/** 媒体文件所在目录（listing 形态，带结尾 `/`）；路径没有分隔符时返回空串。 */
export function mediaDirectory(path: string): string {
  const parts = splitMediaPath(path)
  return parts ? normalizeListingPath(parts.dir) : ''
}

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
 * 的语言/扩展名顺序。
 *
 * 缓存与资源管理器共用（`folder-listing`）：主列表刷新（刷新按钮）会把刚拿到的
 * 列表写进去，所以从 File Lite 之外放进去的字幕，点一次刷新就能被这里看到；
 * 服务端的 `fs.changed` 也会让共用缓存失效/打补丁。任何失败都当「没有」返回：
 * 自动加载不该弹错误。
 *
 * `refreshSubdirs`：主列表刷新只会重写视频自己的目录，`SRT/` 之类的子目录仍是旧缓存，
 * 所以重新扫描（刷新 / `fs.changed`）时要把子目录真的再列一次。
 */
export async function findSiblingFiles(
  mediaPath: string,
  extensions: readonly string[],
  subdirNames: readonly string[] = [],
  options: { refreshSubdirs?: boolean } = {},
): Promise<string[]> {
  const parts = splitMediaPath(mediaPath)
  if (!parts)
    return []

  const entries = await readFolderRawList(parts.dir)
  const found = resolveSiblings(parts.dir, parts.name, entries, extensions)
  if (!subdirNames.length)
    return found

  const wanted = new Set(subdirNames.map(name => name.toLowerCase()))
  for (const entry of entries) {
    if (!entry.isDirectory || !wanted.has(entry.name.toLowerCase()))
      continue
    const subdir = joinPath(parts.dir, entry.name)
    const subEntries = await readFolderRawList(subdir, { force: options.refreshSubdirs })
    found.push(...resolveSiblings(subdir, parts.name, subEntries, extensions))
  }
  return found
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
