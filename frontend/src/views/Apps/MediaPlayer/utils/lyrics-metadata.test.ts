import type { ILyricsTag } from 'music-metadata'
import { describe, expect, test } from 'bun:test'
import { LyricsContentType, TimestampFormat } from 'music-metadata'
import { lyricsLinesFromCommonTags } from './lyrics-metadata'

const lrc = '[00:01.00] first\n[00:02.50] second'
const expected = [
  { time: 1, text: 'first' },
  { time: 2.5, text: 'second' },
]

function uslt(text: string): ILyricsTag {
  return {
    contentType: LyricsContentType.lyrics,
    timeStampFormat: TimestampFormat.notSynchronized,
    text,
    syncText: [],
  }
}

describe('lyricsLinesFromCommonTags', () => {
  test('reads the standard USLT text', () => {
    expect(lyricsLinesFromCommonTags([uslt(lrc)])).toEqual(expected)
  })

  test('reads the standard SYLT syncText', () => {
    expect(lyricsLinesFromCommonTags([{
      contentType: LyricsContentType.lyrics,
      timeStampFormat: TimestampFormat.milliseconds,
      syncText: [
        { timestamp: 1000, text: 'first' },
        { timestamp: 2500, text: 'second' },
      ],
    }])).toEqual(expected)
  })

  test('reads TXXX:UNSYNCED LYRICS, which never reaches common.lyrics', () => {
    expect(lyricsLinesFromCommonTags(undefined, {
      'ID3v2.3': [{ id: 'TXXX:UNSYNCED LYRICS', value: lrc }],
    })).toEqual(expected)
  })

  test('reads a COMM comment whose descriptor names lyrics', () => {
    expect(lyricsLinesFromCommonTags(undefined, {
      'ID3v2.3': [{ id: 'COMM', value: { descriptor: 'UNSYNCED LYRICS', text: lrc } }],
    })).toEqual(expected)
  })

  test('standard lyrics win over a duplicated native frame', () => {
    expect(lyricsLinesFromCommonTags([uslt(lrc)], {
      'ID3v2.3': [{ id: 'TXXX:LYRICS', value: lrc }],
    })).toEqual(expected)
  })

  test('timestamp-free native text is not lyrics', () => {
    expect(lyricsLinesFromCommonTags(undefined, {
      'ID3v2.3': [{ id: 'TXXX:UNSYNCED LYRICS', value: 'just words' }],
    })).toBeUndefined()
  })
})
