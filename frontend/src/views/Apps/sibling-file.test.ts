import { describe, expect, test } from 'bun:test'
import { pickSuffixedSibling, siblingFileCandidates } from './sibling-file'

describe('siblingFileCandidates', () => {
  test('replaces the extension and keeps the order given', () => {
    expect(siblingFileCandidates('/videos/show.s02e09.mkv', ['.srt', '.ass', '.vtt'])).toEqual([
      '/videos/show.s02e09.srt',
      '/videos/show.s02e09.ass',
      '/videos/show.s02e09.vtt',
    ])
  })

  test('a dot in a directory name is not an extension', () => {
    expect(siblingFileCandidates('/a/b.c/movie', ['.lrc'])).toEqual(['/a/b.c/movie.lrc'])
  })

  test('only the last extension is replaced', () => {
    expect(siblingFileCandidates('/a/movie.1080p.mp4', ['.lrc'])).toEqual(['/a/movie.1080p.lrc'])
  })

  test('an empty path has no candidates', () => {
    expect(siblingFileCandidates('', ['.lrc'])).toEqual([])
  })
})

describe('pickSuffixedSibling', () => {
  const subs = ['.srt', '.ass', '.vtt', '.ssa']
  const names = [
    'movie.mkv',
    'movie.chs.srt',
    'movie.eng.srt',
    'movie.zh-CN.ass',
    'other.mkv',
    'other.chs.srt',
    'movie.srt.bak',
  ]

  test('finds any middle segment, whatever its length', () => {
    expect(pickSuffixedSibling('movie.mkv', ['movie.chs.srt'], subs)).toBe('movie.chs.srt')
    expect(pickSuffixedSibling('movie.mkv', ['movie.zh-CN.ass'], subs)).toBe('movie.zh-CN.ass')
    expect(pickSuffixedSibling('movie.mkv', ['movie.zh.Hans.vtt'], subs)).toBe('movie.zh.Hans.vtt')
    expect(pickSuffixedSibling('movie.mkv', ['movie.extended.directors.cut.srt'], subs)).toBe('movie.extended.directors.cut.srt')
  })

  test('prefers the Chinese variant, then the extension order', () => {
    expect(pickSuffixedSibling('movie.mkv', names, subs)).toBe('movie.zh-CN.ass')
    expect(pickSuffixedSibling('movie.mkv', ['movie.eng.srt', 'movie.jpn.srt'], subs)).toBe('movie.eng.srt')
    expect(pickSuffixedSibling('movie.mkv', ['movie.trans.srt', 'movie.chs.vtt'], subs)).toBe('movie.chs.vtt')
  })

  test('ignores other media, the wrong extension and the bare name', () => {
    expect(pickSuffixedSibling('movie.mkv', ['other.chs.srt'], subs)).toBeUndefined()
    expect(pickSuffixedSibling('movie.mkv', ['movie.chs.lrc'], subs)).toBeUndefined()
    // 完全同名的候选不走这里（那一步已经单独问过了）
    expect(pickSuffixedSibling('movie.mkv', ['movie.srt'], subs)).toBeUndefined()
    expect(pickSuffixedSibling('movie.mkv', ['movie.srt.bak'], subs)).toBeUndefined()
  })

  test('matches case-insensitively and ignores a dot-only middle', () => {
    expect(pickSuffixedSibling('movie.mkv', ['Movie.CHS.SRT'], subs)).toBe('Movie.CHS.SRT')
    expect(pickSuffixedSibling('movie.mkv', ['movie..srt'], subs)).toBeUndefined()
  })

  test('a file name without an extension has no suffixes to match', () => {
    expect(pickSuffixedSibling('README', ['README.zh.srt'], subs)).toBe('README.zh.srt')
    expect(pickSuffixedSibling('', ['README.zh.srt'], subs)).toBeUndefined()
  })
})
