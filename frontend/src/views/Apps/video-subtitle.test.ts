import { describe, expect, test } from 'bun:test'
import { subtitleName, subtitleToVtt, subtitleType } from './video-subtitle'

describe('subtitleType', () => {
  test('maps every accepted extension, case-insensitively', () => {
    expect(subtitleType('/a/movie.srt')).toBe('srt')
    expect(subtitleType('/a/movie.SRT')).toBe('srt')
    expect(subtitleType('/a/movie.ass')).toBe('ass')
    expect(subtitleType('/a/movie.ssa')).toBe('ass')
    expect(subtitleType('/a/movie.vtt')).toBe('vtt')
  })
})

describe('subtitleName', () => {
  test('is the base name, for the player menu', () => {
    expect(subtitleName('/a/b/绝命毒师 - S02E09.srt')).toBe('绝命毒师 - S02E09.srt')
    expect(subtitleName('movie.ass')).toBe('movie.ass')
  })
})

describe('subtitleToVtt', () => {
  const srt = '1\r\n00:00:10,000 --> 00:00:15,000\r\n<i>本字幕由YYeTs</i>\r\n\r\n'
  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:10.00,0:00:15.00,Default,,0,0,0,,{\\pos(190,270)}本字幕由YYeTs制作',
    '',
  ].join('\n')

  test('SRT gains a WEBVTT header and dot timestamps', () => {
    const vtt = subtitleToVtt('/a/movie.srt', srt)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt.includes('00:00:10.000 --> 00:00:15.000')).toBe(true)
    expect(vtt.includes('<i>本字幕由YYeTs</i>')).toBe(true)
    expect(vtt.includes('00:00:10,000')).toBe(false)
  })

  test('ASS is converted and its override tags are dropped', () => {
    const vtt = subtitleToVtt('/a/movie.ass', ass)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt.includes('00:00:10.000 --> 00:00:15.000')).toBe(true)
    expect(vtt.includes('本字幕由YYeTs制作')).toBe(true)
    expect(vtt.includes('\\pos')).toBe(false)
  })

  test('a BOM never ends up in front of the first cue', () => {
    expect(subtitleToVtt('/a/movie.srt', `\uFEFF${srt}`).includes('\uFEFF')).toBe(false)
  })

  test('VTT passes through unchanged', () => {
    const vtt = 'WEBVTT\n\n00:00:10.000 --> 00:00:15.000\n你好\n'
    expect(subtitleToVtt('/a/movie.vtt', vtt)).toBe(vtt)
  })
})
