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

/** 一份自动找到的字幕：路径 + 播放器菜单里的名字。 */
export interface SubtitleSource {
  path: string
  /** 视频名后面的语言/版本中缀；完全同名时是调用方给的默认名。 */
  label: string
}

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
 * 字幕相对视频名的中缀，用作字幕轨的显示名。
 *
 * `Top002.这个杀手不太冷.mkv` + `Top002.这个杀手不太冷.简体中文.srt` → `简体中文`；
 * 完全同名（`Top002.这个杀手不太冷.srt`）时返回空字符串，由调用方决定显示什么。
 */
export function subtitleLabel(videoPath: string, subtitlePath: string): string {
  const videoStem = stemOf(videoPath)
  if (!videoStem)
    return ''
  const prefix = `${videoStem}.`
  const subtitleStem = stemOf(subtitlePath)
  if (!subtitleStem.toLowerCase().startsWith(prefix.toLowerCase()))
    return ''
  return subtitleStem.slice(prefix.length)
}

function stemOf(path: string): string {
  const name = subtitleName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
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
