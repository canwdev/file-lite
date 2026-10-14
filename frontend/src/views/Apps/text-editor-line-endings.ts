/**
 * 文本编辑器的行尾处理。
 *
 * `<textarea>` 的 value 只有 LF（浏览器会把 CRLF 规范化掉），所以“文件原本是什么行尾”
 * 只能在刚读到的原始文本上判断，并单独记着，保存时再还原——否则编辑一次就把别人的
 * CRLF 文件变成了 LF。
 */

/** 文件原本的行尾风格。 */
export type LineEnding = 'crlf' | 'lf' | 'cr'

/** 在原始文本上判断行尾：混合行尾取先出现的那种。 */
export function detectLineEnding(text: string): LineEnding {
  if (text.includes('\r\n'))
    return 'crlf'
  if (text.includes('\r'))
    return 'cr'
  return 'lf'
}

/** 按 `ending` 统一行尾；目标行尾本身保持不变。 */
export function applyLineEnding(text: string, ending: LineEnding): string {
  const eol = ending === 'crlf' ? '\r\n' : ending === 'cr' ? '\r' : '\n'
  return text.replace(/\r\n|\r|\n/g, eol)
}
