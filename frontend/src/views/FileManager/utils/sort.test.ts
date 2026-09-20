import type { IEntry } from '../../../types/server'
import { describe, expect, test } from 'bun:test'
import { SortType } from '../../../types/server'
import { composeSortMode, parseSortMode, sortEntries } from './sort'

function entry(partial: Partial<IEntry> & Pick<IEntry, 'name'>): IEntry {
  return {
    ext: '',
    isDirectory: false,
    hidden: false,
    lastModified: 0,
    birthtime: 0,
    size: 0,
    error: null,
    ...partial,
  }
}

describe('parseSortMode / composeSortMode', () => {
  test('default is name ascending', () => {
    expect(parseSortMode(SortType.default)).toEqual({ field: 'name', desc: false })
  })

  test.each([
    [SortType.name, 'name', false],
    [SortType.nameDesc, 'name', true],
    [SortType.extension, 'extension', false],
    [SortType.extensionDesc, 'extension', true],
    [SortType.size, 'size', false],
    [SortType.sizeDesc, 'size', true],
    [SortType.lastModified, 'lastModified', false],
    [SortType.lastModifiedDesc, 'lastModified', true],
    [SortType.birthTime, 'birthTime', false],
    [SortType.birthTimeDesc, 'birthTime', true],
  ] as const)('%s → field %s desc %s', (mode, field, desc) => {
    expect(parseSortMode(mode)).toEqual({ field, desc })
    expect(composeSortMode(field, desc)).toBe(mode)
  })

  test('unknown stored value falls back to name ascending', () => {
    expect(parseSortMode('nope' as SortType)).toEqual({ field: 'name', desc: false })
  })
})

describe('sortEntries direction', () => {
  const files = [
    entry({ name: 'b.txt', ext: '.txt', size: 20, lastModified: 2 }),
    entry({ name: 'a.txt', ext: '.txt', size: 10, lastModified: 1 }),
  ]

  test('name descending is the reverse of name ascending', () => {
    const asc = sortEntries(files, SortType.name, true, false).map(item => item.name)
    const desc = sortEntries(files, SortType.nameDesc, true, false).map(item => item.name)
    expect(asc).toEqual(['a.txt', 'b.txt'])
    expect(desc).toEqual(['b.txt', 'a.txt'])
  })

  test('size descending is the reverse of size ascending', () => {
    const asc = sortEntries(files, SortType.size, true, false).map(item => item.size)
    const desc = sortEntries(files, SortType.sizeDesc, true, false).map(item => item.size)
    expect(asc).toEqual([10, 20])
    expect(desc).toEqual([20, 10])
  })
})
