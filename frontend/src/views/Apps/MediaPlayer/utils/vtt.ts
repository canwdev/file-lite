import type { LyricLine } from './lrc'

/**
 * 解析 WebVTT 歌词（从视频网站导出的 `.vtt` 很常见）。
 *
 * 只取 cue 的时间与文本：`NOTE` / `STYLE` / `REGION` 块和 cue 设置（`align:` 之类）
 * 都跳过，内联标签（`<v>`、`<c>`、逐字时间戳…）去掉——歌词只留纯文本。
 * 一个 cue 里的多行合成一行，因为 `LyricLine` 就是一行一句。
 */
export function parseVttString(raw: string): LyricLine[] {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  const out: LyricLine[] = []
  let index = lines[0]?.trim().startsWith('WEBVTT') ? 1 : 0

  while (index < lines.length) {
    const timing = lines[index++]!.match(VTT_TIMING)
    if (!timing)
      continue

    const parts: string[] = []
    for (; index < lines.length && lines[index]!.trim(); index++)
      parts.push(stripVttTags(lines[index]!))

    const text = parts.join(' ').trim()
    if (text)
      out.push({ time: vttTimeToSeconds(timing[1]!), text })
  }

  out.sort((a, b) => a.time - b.time)
  return out
}

/** `HH:MM:SS.mmm --> HH:MM:SS.mmm`；短写 `MM:SS.mmm` 和误用逗号的都收，时间后面的 cue 设置丢掉。 */
const VTT_TIMING = /(\d{1,3}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->/

function vttTimeToSeconds(stamp: string): number {
  const parts = stamp.replace(',', '.').split(':')
  const seconds = Number.parseFloat(parts.pop() ?? '0')
  const minutes = Number.parseInt(parts.pop() ?? '0', 10)
  const hours = parts.length ? Number.parseInt(parts.pop()!, 10) : 0
  return hours * 3600 + minutes * 60 + seconds
}

/** 去掉 WebVTT 内联标签；浏览器渲染时未知标签本来也是丢掉的。 */
function stripVttTags(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim()
}
