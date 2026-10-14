import { describe, expect, test } from 'bun:test'
import { applyLineEnding, detectLineEnding } from './text-editor-line-endings'

/**
 * 保存必须逐字节忠于原文件：编辑器里只有 LF，写回时要还原打开时记下的行尾。
 */
describe('detectLineEnding', () => {
  test('CRLF is recognized even when LF appears later', () => {
    expect(detectLineEnding('1\r\n00:00:10\r\n本字幕')).toBe('crlf')
  })

  test('plain LF', () => {
    expect(detectLineEnding('a\nb\n')).toBe('lf')
  })

  test('classic Mac CR', () => {
    expect(detectLineEnding('a\rb\r')).toBe('cr')
  })

  test('a single line has no ending to preserve', () => {
    expect(detectLineEnding('no break here')).toBe('lf')
  })
})

describe('applyLineEnding', () => {
  test('a CRLF file survives a textarea round trip', () => {
    expect(applyLineEnding('a\nb\n', 'crlf')).toBe('a\r\nb\r\n')
  })

  test('an LF file stays LF even if CRLF was pasted in', () => {
    expect(applyLineEnding('a\r\nb\rc\n', 'lf')).toBe('a\nb\nc\n')
  })

  test('CR is restored the same way', () => {
    expect(applyLineEnding('a\nb', 'cr')).toBe('a\rb')
  })

  test('already-correct endings are left alone', () => {
    expect(applyLineEnding('a\r\nb\r\n', 'crlf')).toBe('a\r\nb\r\n')
  })

  test('the last line without an ending gains none', () => {
    expect(applyLineEnding('a\nb', 'crlf')).toBe('a\r\nb')
  })
})
