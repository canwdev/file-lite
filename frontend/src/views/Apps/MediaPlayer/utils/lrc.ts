/** One timed lyric line; `time` in seconds from track start. */
export interface LyricLine {
  time: number
  text: string
}

/**
 * Parse classic LRC text (no third-party deps).
 * Supports [mm:ss.xx] / [mm:ss.xxx], [offset:±ms], skips [ar:][ti:] meta lines.
 * Multiple timestamps on one line become multiple entries.
 */
export function parseLrcString(raw: string): LyricLine[] {
  const lines = raw.split(/\r?\n/)
  const out: LyricLine[] = []
  let offsetSec = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed)
      continue

    const offsetMatch = trimmed.match(/^\[offset:\s*([+-]?\d+)\]/i)
    if (offsetMatch) {
      offsetSec = Number.parseInt(offsetMatch[1]!, 10) / 1000
      continue
    }
    // 解析元数据标签 [ar:][ti:][al:] 等，时间戳设为 0
    const metaMatch = trimmed.match(/^\[(ar|ti|al|by|tool|length|ve):\s*([\s\S]*?)\]/i)
    if (metaMatch) {
      const tagName = metaMatch[1]!.toLowerCase()
      const tagValue = metaMatch[2]!.trim()
      if (tagValue) {
        const labelMap: Record<string, string> = {
          ar: '艺术家',
          ti: '标题',
          al: '专辑',
          by: '制作',
          tool: '工具',
          length: '长度',
          ve: '版本',
        }
        out.push({ time: 0, text: `${labelMap[tagName] || tagName}: ${tagValue}` })
      }
      continue
    }

    const tsRe = /\[(\d{2}):(\d{2})[.:](\d{2}|\d{3})\]/g
    const stamps: number[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    for (match = tsRe.exec(trimmed); match !== null; match = tsRe.exec(trimmed)) {
      stamps.push(timestampToSeconds(match[1]!, match[2]!, match[3]!))
      lastIndex = match.index + match[0].length
    }
    if (stamps.length === 0)
      continue

    let text = trimmed.slice(lastIndex).trim()
    if (!text)
      continue
    // 清理 ELRC 逐字时间戳 <00:00.00>，保留纯文本
    text = text.replace(/<\d{2}:\d{2}[.:]\d{2,3}>/g, '')

    for (const t of stamps) {
      out.push({ time: Math.max(0, t + offsetSec), text })
    }
  }

  out.sort((a, b) => a.time - b.time)
  return dedupeAdjacent(out)
}

function timestampToSeconds(mm: string, ss: string, frac: string): number {
  const minutes = Number.parseInt(mm, 10)
  const seconds = Number.parseInt(ss, 10)
  const ms = frac.length === 3
    ? Number.parseInt(frac, 10)
    : Number.parseInt(frac, 10) * 10
  return (minutes * 60 + seconds) + ms / 1000
}

function dedupeAdjacent(lines: LyricLine[]): LyricLine[] {
  if (lines.length <= 1)
    return lines
  const r: LyricLine[] = [lines[0]!]
  for (let i = 1; i < lines.length; i++) {
    const cur = lines[i]!
    const prev = r[r.length - 1]!
    if (Math.abs(cur.time - prev.time) < 0.001 && cur.text === prev.text)
      continue
    r.push(cur)
  }
  return r
}
