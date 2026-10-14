/**
 * 视频播放器自动加载同名字幕：类型判断与格式转换。
 *
 * 找文件在 `sibling-lookup`，取文件与创建 blob 由播放器自己负责——Artplayer 直接吃
 * 服务端 URL，原生 `<video>` 得先转成 WebVTT。转换用 Artplayer 自己的转换器，两条
 * 播放路径解析出来的字幕才一致。
 */
import Artplayer from 'artplayer'

/** 字幕扩展名，按优先级：SRT 最常见，其次是带样式的 ASS，再是 WebVTT 和旧的 SSA。 */
export const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.vtt', '.ssa']

/** Artplayer 的 `subtitle.switch` 与 `<track>` 认识的字幕类型。 */
export type SubtitleType = 'srt' | 'ass' | 'vtt'

/** 字幕类型：Artplayer 用它挑解析器。 */
export function subtitleType(path: string): SubtitleType {
  const lower = path.toLowerCase()
  if (lower.endsWith('.vtt'))
    return 'vtt'
  if (lower.endsWith('.ass') || lower.endsWith('.ssa'))
    return 'ass'
  return 'srt'
}

/** 字幕文件名，用作播放器字幕菜单里的名字。 */
export function subtitleName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * 字幕内容转成 WebVTT，供原生 `<video>` 的 `<track>` 使用。
 *
 * SRT / ASS 走 Artplayer 自己的转换器；`.vtt` 原样通过，只去掉可能存在的 BOM。
 */
export function subtitleToVtt(path: string, text: string): string {
  const body = text.replace(/^\uFEFF/, '')
  switch (subtitleType(path)) {
    case 'srt':
      return Artplayer.utils.srtToVtt(body)
    case 'ass':
      return Artplayer.utils.assToVtt(body)
    default:
      return body
  }
}
