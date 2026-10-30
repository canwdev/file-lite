import type { LyricLine } from './lrc'
import type { FileLiteSdk } from '@/sdk/contract'
import { findSiblingFile } from '../../sibling-lookup'
import { parseLrcString } from './lrc'
import { parseVttString } from './vtt'

/** 歌词扩展名，按优先级：LRC 是歌词的通用格式，VTT 多见于从视频网站导出的。 */
const LYRIC_EXTENSIONS = ['.lrc', '.vtt']

/**
 * 找音频同目录、同名的歌词文件（`.lrc` / `.vtt`）并解析成歌词行。
 *
 * 内嵌标签里的歌词优先，这里只是兜底；完全同名的 `song.lrc` 和带中缀的
 * `song.zh.lrc` 都能找到（见 `findSiblingFile`）。没有文件、读不出来、或者解析不出
 * 内容都返回 `undefined`——自动加载不该弹错误提示。编码由内容端点统一转成 UTF-8
 * （LRC 常见 GBK）。
 */
export async function loadSiblingLyrics(audioPath: string, sdk: FileLiteSdk): Promise<LyricLine[] | undefined> {
  try {
    const found = await findSiblingFile(audioPath, LYRIC_EXTENSIONS)
    if (!found)
      return undefined
    const { text } = await sdk.readText(found)
    const lines = found.toLowerCase().endsWith('.lrc') ? parseLrcString(text) : parseVttString(text)
    return lines.length ? lines : undefined
  }
  catch (error) {
    console.error('load lyrics failed', error)
    return undefined
  }
}
