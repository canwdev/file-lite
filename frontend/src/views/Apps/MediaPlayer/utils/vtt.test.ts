import { describe, expect, test } from 'bun:test'
import { parseVttString } from './vtt'

describe('parseVttString', () => {
  test('takes the cue start time and text, in order', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:10.000 --> 00:00:15.000',
      '第一句',
      '',
      '00:00:16.000 --> 00:00:18.000',
      '第二句',
      '',
    ].join('\n')
    expect(parseVttString(vtt)).toEqual([
      { time: 10, text: '第一句' },
      { time: 16, text: '第二句' },
    ])
  })

  test('accepts the short timestamp form and sorts by time', () => {
    const vtt = 'WEBVTT\n\n01:05.500 --> 01:10.000\n后面\n\n00:10.000 --> 00:15.000\n前面\n'
    expect(parseVttString(vtt)).toEqual([
      { time: 10, text: '前面' },
      { time: 65.5, text: '后面' },
    ])
  })

  test('drops cue settings, cue identifiers and inline tags', () => {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE 这是注释，不该出现',
      '',
      'cue-1',
      '00:00:10.000 --> 00:00:15.000 align:middle line:90%',
      '<v 歌手><c.yellow>带标签的歌词</c></v>',
      '',
      '00:00:20.000 --> 00:00:22.000',
      '<00:00:20.500>逐字<00:00:21.000>时间戳',
      '',
    ].join('\n')
    expect(parseVttString(vtt)).toEqual([
      { time: 10, text: '带标签的歌词' },
      { time: 20, text: '逐字时间戳' },
    ])
  })

  test('joins a multi-line cue into one lyric line', () => {
    const vtt = 'WEBVTT\n\n00:00:10.000 --> 00:00:15.000\n原文\n译文\n\n'
    expect(parseVttString(vtt)).toEqual([{ time: 10, text: '原文 译文' }])
  })

  test('handles a BOM, CRLF and stub files', () => {
    expect(parseVttString('\uFEFFWEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\n你好\r\n\r\n')).toEqual([
      { time: 1, text: '你好' },
    ])
    expect(parseVttString('WEBVTT\n\n')).toEqual([])
    expect(parseVttString('')).toEqual([])
  })
})
