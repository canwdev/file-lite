/**
 * 从音频文件的内嵌标签里抽取封面（ID3v2 APIC / FLAC PICTURE / MP4 covr / Vorbis 等）。
 *
 * 只做**内嵌封面**，不去找同目录的 cover.jpg —— 那是另一条路。
 *
 * 两个关键点：
 * - `music-metadata` 与 Range tokenizer 都是**动态导入**：FileLite 主包不该为了
 *   网格里的一张封面就把整个解析器打进首屏 chunk（播放器那边本来就是懒加载的独立 chunk）。
 * - tokenizer 走 HTTP Range（见 stream-metadata-tokenizer），所以**不需要把整个音频
 *   文件下下来**；媒体库里常见的 M4A 把 moov 放在文件尾部也能 seek 到。
 */

/** 内嵌封面上限：超大的封面解出来会占掉几百 MB 位图，和图片那条路是同一个问题 */
const MAX_EMBEDDED_COVER_BYTES = 20 * 1024 * 1024

export interface ExtractedCover {
  blob: Blob
  mimeType: string
}

/**
 * 解析内嵌封面。返回 null 表示「这个文件没有内嵌封面」—— 一个确定的否定结果，
 * 调用方应当记住它，避免每次滚回来都重新探测一遍。
 * 抛错表示读取/解析失败。
 */
export async function extractEmbeddedCover(
  streamUrl: string,
  signal?: AbortSignal,
): Promise<ExtractedCover | null> {
  if (!streamUrl || signal?.aborted) {
    return null
  }

  const [{ parseFromTokenizer, selectCover }, { makeStreamMetadataTokenizer }] = await Promise.all([
    import('music-metadata'),
    import('@/views/Apps/MediaPlayer/utils/stream-metadata-tokenizer'),
  ])

  if (signal?.aborted) {
    return null
  }

  const tokenizer = await makeStreamMetadataTokenizer(streamUrl, undefined, undefined, signal)
  try {
    // duration: false —— 时长要用不着，少读一段就少一组 Range 请求
    const meta = await parseFromTokenizer(tokenizer, { duration: false })
    const cover = selectCover(meta.common.picture)
    if (!cover?.data?.length) {
      return null
    }
    if (cover.data.length > MAX_EMBEDDED_COVER_BYTES) {
      return null
    }
    const mimeType = cover.format || 'image/jpeg'
    return {
      blob: new Blob([cover.data.slice()], { type: mimeType }),
      mimeType,
    }
  }
  finally {
    try {
      await tokenizer.close()
    }
    catch {
      // ignore
    }
  }
}
