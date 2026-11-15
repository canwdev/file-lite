import type { IEntry } from '@/types/server'
import { describe, expect, test } from 'bun:test'
import { mergeFsDirChanges } from './fs-change-buffer'

function entry(name: string): IEntry {
  return {
    name,
    path: `/d/${name}`,
    ext: '',
    isDirectory: false,
    hidden: false,
    lastModified: 0,
    birthtime: 0,
    size: 0,
    error: null,
  }
}

describe('mergeFsDirChanges', () => {
  test('merges added and removed names per directory', () => {
    const merged = mergeFsDirChanges([
      { dir: '/d', removed: ['a'], added: [entry('b')] },
      { dir: '/d', updated: [entry('c')] },
      { dir: '/other', removed: ['x'] },
    ])
    expect(merged).toEqual([
      { dir: '/d', added: [entry('b')], updated: [entry('c')], removed: ['a'] },
      { dir: '/other', removed: ['x'] },
    ])
  })

  test('the last operation wins for the same name', () => {
    const addedThenRemoved = mergeFsDirChanges([
      { dir: '/d', added: [entry('x')] },
      { dir: '/d', removed: ['x'] },
    ])
    expect(addedThenRemoved).toEqual([{ dir: '/d', removed: ['x'] }])

    const removedThenAdded = mergeFsDirChanges([
      { dir: '/d', removed: ['x'] },
      { dir: '/d', added: [entry('x')] },
    ])
    expect(removedThenAdded).toEqual([{ dir: '/d', added: [entry('x')] }])

    const addedThenUpdated = mergeFsDirChanges([
      { dir: '/d', added: [entry('x')] },
      { dir: '/d', updated: [entry('x')] },
    ])
    expect(addedThenUpdated).toEqual([{ dir: '/d', updated: [entry('x')] }])
  })

  test('drops an empty directory change', () => {
    expect(mergeFsDirChanges([{ dir: '/d' }])).toEqual([])
  })
})
