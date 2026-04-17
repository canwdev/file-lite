import type { ILyricsTag } from 'music-metadata'
import type { LyricLine } from './lrc'
import { parseLrcString } from './lrc'

/** Build timed lines from `music-metadata` `common.lyrics` (sync + optional raw LRC in `text`). */
export function lyricsLinesFromCommonTags(tags: ILyricsTag[] | undefined): LyricLine[] | undefined {
  if (!tags?.length)
    return undefined

  const acc: LyricLine[] = []

  for (const tag of tags) {
    if (tag.syncText?.length) {
      for (const st of tag.syncText) {
        if (typeof st.timestamp === 'number' && st.text?.trim()) {
          acc.push({ time: st.timestamp / 1000, text: st.text.trim() })
        }
      }
    }
    else if (tag.text?.trim() && /\[\d{2}:\d{2}/.test(tag.text)) {
      acc.push(...parseLrcString(tag.text))
    }
  }

  if (!acc.length)
    return undefined

  acc.sort((a, b) => a.time - b.time)
  return acc
}
