/**
 * 前端侧的文本编码探测。
 *
 * 服务端会把内容端点上的文本转成 UTF-8 并带回编码，本地选的文件不经过服务端，
 * 只能在这里探一次，再把结果交给 `TextDecoder`（Artplayer 的字幕就是这么解的）。
 *
 * 判断顺序与后端 `backend-go/textencoding` 一致：BOM → UTF-8 → GB18030 → …，
 * 但候选表短一截，原因写在 `LEGACY_CHARSETS` 上。
 */

/** 探测只看开头：字幕文件很小，选错一个超大文件时也不该整个读进内存再解几遍。 */
const SAMPLE_SIZE = 512 * 1024

/**
 * 非 UTF-8 的候选，按优先级排列。
 *
 * 浏览器的 gb18030 解码器能把全部 Big5 双字节都映射出来，所以这里分不出 Big5
 * （服务端的 Go 表能，同一个 Big5 文件从服务端打开是对的）；EUC-KR 和后端一样不收。
 * Shift-JIS 保留：半角片假名（0xA1–0xDF 单字节）不是合法 gb18030。
 */
const LEGACY_CHARSETS = ['gb18030', 'shift_jis'] as const

/** 猜一个 Blob 里文本的编码；读不出来就按 UTF-8 处理。 */
export async function detectBlobTextEncoding(blob: Blob): Promise<string> {
  try {
    const sample = new Uint8Array(await blob.slice(0, SAMPLE_SIZE).arrayBuffer())
    return detectTextEncoding(sample)
  }
  catch {
    return 'utf-8'
  }
}

/** 猜一段字节的编码，返回值可以直接交给 `TextDecoder`。 */
export function detectTextEncoding(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
    return 'utf-8'
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
    return 'utf-16le'
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF)
    return 'utf-16be'
  if (isLossless(bytes, 'utf-8'))
    return 'utf-8'
  for (const charset of LEGACY_CHARSETS) {
    if (isLossless(bytes, charset))
      return charset
  }
  // 都不合法时按最可能的猜：解码器会把解不出的字节替换成 U+FFFD，不会抛错。
  return 'gb18030'
}

/** 这份字节能不能被这个编码完整解出来：fatal 模式下不合法的序列会抛错。 */
function isLossless(bytes: Uint8Array, encoding: string): boolean {
  try {
    new TextDecoder(encoding, { fatal: true }).decode(bytes)
    return true
  }
  catch {
    return false
  }
}
