import { describe, expect, test } from 'bun:test'
import { detectBlobTextEncoding, detectTextEncoding } from './text-encoding'

/** 十六进制写字节，省得在测试里塞一堆不可见字符。 */
function bytes(hex: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hex.trim().split(/\s+/).filter(Boolean).map(part => Number.parseInt(part, 16)))
}

/** 探测结果必须能把这个字节串解成期望的文本。 */
function expectDecodesTo(raw: Uint8Array, encoding: string, text: string) {
  expect(detectTextEncoding(raw)).toBe(encoding)
  expect(new TextDecoder(encoding).decode(raw)).toBe(text)
}

describe('detectTextEncoding', () => {
  test('UTF-8, with or without a BOM', () => {
    expectDecodesTo(new TextEncoder().encode('00:00:10,000 --> 00:00:15,000'), 'utf-8', '00:00:10,000 --> 00:00:15,000')
    expectDecodesTo(new TextEncoder().encode('本字幕由人人影视翻译制作'), 'utf-8', '本字幕由人人影视翻译制作')
    // TextDecoder 会吃掉 BOM，字幕解析器看到的还是干净文本
    expectDecodesTo(bytes('ef bb bf 31 0a'), 'utf-8', '1\n')
  })

  test('UTF-16 byte order marks', () => {
    expectDecodesTo(bytes('ff fe 68 00 69 00'), 'utf-16le', 'hi')
    expectDecodesTo(bytes('fe ff 00 68 00 69'), 'utf-16be', 'hi')
  })

  test('GBK is served as GB18030, which shares its byte layout', () => {
    expectDecodesTo(bytes('b1 be d7 d6 c4 bb d3 c9'), 'gb18030', '本字幕由')
  })

  test('half-width katakana is not valid GB18030, so it stays Shift-JIS', () => {
    expectDecodesTo(
      bytes('b7 de ac b0 20 cb c4 de b2 20 d4 d2 c3 20 b8 da b0'),
      'shift_jis',
      'ｷﾞｬｰ ﾋﾄﾞｲ ﾔﾒﾃ ｸﾚｰ',
    )
  })

  test('garbage falls back to GB18030 instead of failing', () => {
    expect(detectTextEncoding(bytes('41 ff fe 42'))).toBe('gb18030')
  })

  test('empty input is UTF-8', () => {
    expect(detectTextEncoding(new Uint8Array([]))).toBe('utf-8')
  })
})

describe('detectBlobTextEncoding', () => {
  test('reads a Blob the way the file picker hands one over', async () => {
    const blob = new Blob([bytes('b1 be d7 d6 c4 bb d3 c9')])
    expect(await detectBlobTextEncoding(blob)).toBe('gb18030')
  })

  test('only the head of a large blob is probed', async () => {
    const head = bytes('b1 be d7 d6 c4 bb d3 c9')
    const blob = new Blob([head, new Uint8Array(2 * 1024 * 1024)])
    expect(await detectBlobTextEncoding(blob)).toBe('gb18030')
  })
})
