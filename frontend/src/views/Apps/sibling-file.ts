/**
 * 同一个目录、同一个文件名、只换扩展名的候选路径。
 *
 * 视频字幕和音乐歌词都靠它找「旁边的那个文件」：`show.s02e09.mkv` →
 * `show.s02e09.srt`，`song.flac` → `song.lrc`。
 */
export function siblingFileCandidates(path: string, extensions: readonly string[]): string[] {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  // 目录名里的点不算扩展名：`/a/b.c/movie` 的 stem 就是它自己。
  const stem = dot > slash ? path.slice(0, dot) : path
  if (!stem)
    return []
  return extensions.map(extension => stem + extension)
}

/**
 * 带语言/用途中缀的同名字幕或歌词：`<名字>.<xx>.<扩展名>`，`xx` 长度不限
 * （`chs`、`zh-CN`、`zh.Hans`、`trans`…）。
 *
 * 中缀没法枚举，所以只能拿目录里的名字匹配；完全同名的那种由
 * `siblingFileCandidates` 单独先问一次、优先使用，不走这里。
 *
 * 同时存在多个中缀时：先按 `PREFERRED_SUFFIXES` 的常见语言顺序，再按扩展名顺序，
 * 最后按名字排序——保证同一份目录每次挑中的都一样。
 */
export function pickSuffixedSibling(mediaName: string, names: readonly string[], extensions: readonly string[]): string | undefined {
  const dot = mediaName.lastIndexOf('.')
  const stem = dot > 0 ? mediaName.slice(0, dot) : mediaName
  if (!stem)
    return undefined

  const prefix = `${stem}.`.toLowerCase()
  const matches: { name: string, suffix: string, extensionIndex: number }[] = []

  for (const name of names) {
    const lower = name.toLowerCase()
    if (!lower.startsWith(prefix))
      continue
    const rest = lower.slice(prefix.length)
    const extensionIndex = extensions.findIndex(extension => rest.endsWith(extension))
    if (extensionIndex < 0)
      continue
    const suffix = rest.slice(0, rest.length - extensions[extensionIndex]!.length)
    if (suffix)
      matches.push({ name, suffix, extensionIndex })
  }
  if (!matches.length)
    return undefined

  matches.sort((a, b) => {
    const rank = suffixRank(a.suffix) - suffixRank(b.suffix)
    if (rank !== 0)
      return rank
    if (a.extensionIndex !== b.extensionIndex)
      return a.extensionIndex - b.extensionIndex
    return a.name.localeCompare(b.name)
  })
  return matches[0]!.name
}

/** 常见的中缀，越靠前越优先；表外的排在最后、按名字定胜负。 */
const PREFERRED_SUFFIXES = [
  'zh-cn',
  'zh-hans',
  'zh',
  'chs',
  'sc',
  'chi',
  'zh-tw',
  'zh-hant',
  'cht',
  'tc',
  'en',
  'eng',
  'ja',
  'jpn',
  'ko',
  'kor',
]

function suffixRank(suffix: string): number {
  const index = PREFERRED_SUFFIXES.indexOf(suffix)
  return index < 0 ? PREFERRED_SUFFIXES.length : index
}
