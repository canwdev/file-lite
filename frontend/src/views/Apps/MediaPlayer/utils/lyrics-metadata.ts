import type { IAudioMetadata, ILyricsTag } from 'music-metadata'
import type { LyricLine } from './lrc'
import { parseLrcString } from './lrc'

/** 标签编辑器把歌词放进非标准字段时常用的描述：TXXX:UNSYNCED LYRICS / COMM:Lyrics ... */
function isLyricsDescriptor(descriptor: string | undefined): boolean {
  if (!descriptor)
    return false
  const value = descriptor.trim().toLowerCase()
  return value.includes('lyric') || value === 'uslt'
}

/** 只有带时间轴的文本播放器才能逐行显示 */
function hasLrcTimestamps(text: string): boolean {
  return /\[\d{1,3}:\d{2}/.test(text)
}

/** TXXX:<描述>、APE/Vorbis 的 Lyrics 键等；标准 USLT/SYLT 已由 common.lyrics 处理 */
function isLyricsTagId(id: string): boolean {
  if (id.startsWith('TXXX:'))
    return isLyricsDescriptor(id.slice(5))
  return /^(?:lyrics?|unsynced ?lyrics|synced ?lyrics)$/i.test(id.trim())
}

/**
 * Build timed lines from `music-metadata` `common.lyrics` (sync + optional raw LRC in `text`),
 * plus the non-standard frames taggers use instead of the USLT one.
 *
 * `music-metadata` 只把 USLT / SYLT 等标准字段映射到 `common.lyrics`。很多文件由标签
 * 编辑器写成 `TXXX:UNSYNCED LYRICS`、`TXXX:LYRICS`、APE `Lyrics` 或 `COMM` 注释，
 * 这些不会进入 `common.lyrics`，所以标准字段没有时间轴时再扫一遍原生标签表。
 */
export function lyricsLinesFromCommonTags(
  tags: ILyricsTag[] | undefined,
  native?: IAudioMetadata['native'],
): LyricLine[] | undefined {
  const acc: LyricLine[] = []

  for (const tag of tags ?? []) {
    if (tag.syncText?.length) {
      for (const st of tag.syncText) {
        if (typeof st.timestamp === 'number' && st.text?.trim()) {
          acc.push({ time: st.timestamp / 1000, text: st.text.trim() })
        }
      }
    }
    else if (tag.text?.trim() && hasLrcTimestamps(tag.text)) {
      acc.push(...parseLrcString(tag.text))
    }
  }

  // 标准字段没有可用时间轴时才扫原生标签，避免同一份歌词被解析两遍
  if (!acc.length && native) {
    for (const nativeTags of Object.values(native)) {
      for (const tag of nativeTags) {
        if (typeof tag.value === 'string') {
          if (isLyricsTagId(tag.id) && hasLrcTimestamps(tag.value))
            acc.push(...parseLrcString(tag.value))
          continue
        }
        // COMM（ID3v2.2 里是 COM）的值是 { descriptor, text }：只有描述像歌词的才当歌词
        if ((tag.id === 'COMM' || tag.id === 'COM') && tag.value && typeof tag.value === 'object') {
          const comment = tag.value as { descriptor?: string, text?: string }
          if (isLyricsDescriptor(comment.descriptor) && typeof comment.text === 'string' && hasLrcTimestamps(comment.text))
            acc.push(...parseLrcString(comment.text))
        }
      }
    }
  }

  if (!acc.length)
    return undefined

  acc.sort((a, b) => a.time - b.time)
  return acc
}
