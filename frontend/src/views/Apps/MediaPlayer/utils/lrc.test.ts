import { describe, expect, test } from 'bun:test'
import { parseLrcString } from './lrc'

const sample = [
  '[ti:歌名]',
  '[ar:歌手]',
  '[al:专辑]',
  '[offset:+500]',
  '[00:12.34]第一句',
  '[00:15.00][00:20.00]重复的一句',
  '[00:18.5]一位小数',
  '[00:21.250]三位小数',
  '[00:25.00]',
  '',
].join('\n')

describe('parseLrcString', () => {
  test('reads timestamps, applies the offset and expands repeated stamps', () => {
    expect(parseLrcString(sample)).toEqual([
      { time: 0, text: '标题: 歌名' },
      { time: 0, text: '艺术家: 歌手' },
      { time: 0, text: '专辑: 专辑' },
      { time: 12.84, text: '第一句' },
      { time: 15.5, text: '重复的一句' },
      { time: 19, text: '一位小数' },
      { time: 20.5, text: '重复的一句' },
      { time: 21.75, text: '三位小数' },
    ])
  })

  test('an empty or timestamp-free file has no lyrics', () => {
    expect(parseLrcString('')).toEqual([])
    expect(parseLrcString('[ti:只有标签]')).toEqual([{ time: 0, text: '标题: 只有标签' }])
  })
})
