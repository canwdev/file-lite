import type { IEntry } from '../../../types/server'
import { describe, expect, test } from 'bun:test'
import { dateGroupKey, groupEntries, nameGroupKey, sizeGroupKey } from './group'

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

/** 2026-09-20 周日 15:00 本地。周一制的「本周」是 9/14–9/20。 */
const NOW = new Date(2026, 8, 20, 15, 0, 0).getTime()

describe('dateGroupKey', () => {
  test('buckets match Explorer-style ranges', () => {
    expect(dateGroupKey(new Date(2026, 8, 20, 10, 0, 0).getTime(), NOW).label).toBe('Today')
    expect(dateGroupKey(new Date(2026, 8, 19, 10, 0, 0).getTime(), NOW).label).toBe('Yesterday')
    expect(dateGroupKey(new Date(2026, 8, 17, 10, 0, 0).getTime(), NOW).label).toBe('Earlier this week')
    expect(dateGroupKey(new Date(2026, 8, 11, 10, 0, 0).getTime(), NOW).label).toBe('Last week')
    expect(dateGroupKey(new Date(2026, 8, 4, 10, 0, 0).getTime(), NOW).label).toBe('Earlier this month')
    expect(dateGroupKey(new Date(2026, 7, 4, 10, 0, 0).getTime(), NOW).label).toBe('Last month')
    expect(dateGroupKey(new Date(2026, 1, 1, 10, 0, 0).getTime(), NOW).label).toBe('Earlier this year')
    expect(dateGroupKey(new Date(2025, 5, 1, 10, 0, 0).getTime(), NOW).label).toBe('Last year')
    expect(dateGroupKey(new Date(2024, 0, 1, 10, 0, 0).getTime(), NOW).label).toBe('A long time ago')
  })
})

describe('sizeGroupKey', () => {
  test('folders are Unspecified', () => {
    expect(sizeGroupKey(entry({ name: 'dir', isDirectory: true, size: null })).label).toBe('Unspecified')
  })

  test('file size buckets', () => {
    expect(sizeGroupKey(entry({ name: 'a', size: 0 })).label).toBe('Empty (0KB)')
    expect(sizeGroupKey(entry({ name: 'a', size: 100 })).label).toBe('Tiny (< 16KB)')
    expect(sizeGroupKey(entry({ name: 'a', size: 20 * 1024 })).label).toBe('Small (< 1MB)')
    expect(sizeGroupKey(entry({ name: 'a', size: 2 * 1024 * 1024 })).label).toBe('Medium (< 128MB)')
    expect(sizeGroupKey(entry({ name: 'a', size: 200 * 1024 * 1024 })).label).toBe('Large (< 1GB)')
    expect(sizeGroupKey(entry({ name: 'a', size: 2 * 1024 * 1024 * 1024 })).label).toBe('Huge (< 4GB)')
    expect(sizeGroupKey(entry({ name: 'a', size: 5 * 1024 * 1024 * 1024 })).label).toBe('Gigantic (≥ 4GB)')
  })
})

describe('nameGroupKey', () => {
  test('letters, digits and other first characters', () => {
    expect(nameGroupKey('apple').label).toBe('A')
    expect(nameGroupKey('Banana').label).toBe('B')
    expect(nameGroupKey('12-tools').label).toBe('0-9')
    expect(nameGroupKey('寻影').label).toBe('寻')
  })
})

describe('groupEntries', () => {
  test('keeps input order inside a group and sorts groups by the field', () => {
    const files = [
      entry({ name: 'b.txt', lastModified: new Date(2026, 8, 20).getTime() }),
      entry({ name: 'a.txt', lastModified: new Date(2026, 8, 20).getTime() }),
      entry({ name: 'old.txt', lastModified: new Date(2026, 7, 4).getTime() }),
    ]
    const groups = groupEntries(files, 'lastModified', true, { now: NOW })
    expect(groups.map(g => g.label)).toEqual(['Today', 'Last month'])
    expect(groups[0].items.map(i => i.name)).toEqual(['b.txt', 'a.txt'])
  })

  test('ascending date groups put older buckets first', () => {
    const files = [
      entry({ name: 'new', lastModified: new Date(2026, 8, 20).getTime() }),
      entry({ name: 'old', lastModified: new Date(2026, 7, 4).getTime() }),
    ]
    const groups = groupEntries(files, 'lastModified', false, { now: NOW })
    expect(groups.map(g => g.label)).toEqual(['Last month', 'Today'])
  })
})
