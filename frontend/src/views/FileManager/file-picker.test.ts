import type { IEntry } from '@/types/server'
import { describe, expect, test } from 'bun:test'
import { toPickResult } from './file-picker'

function entry(name: string, overrides: Partial<IEntry> = {}): IEntry {
  return {
    name,
    path: `/docs/${name}`,
    ext: name.includes('.') ? `.${name.split('.').pop()}` : '',
    isDirectory: false,
    hidden: false,
    lastModified: 1,
    birthtime: 1,
    size: 10,
    error: null,
    ...overrides,
  }
}

describe('toPickResult', () => {
  test('save returns the typed name joined onto the chosen folder', () => {
    expect(toPickResult({ basePath: '/docs/', name: 'note.txt' }, 'save', '/docs/')).toEqual({
      items: [],
      directory: '/docs/',
      path: '/docs/note.txt',
      name: 'note.txt',
    })
  })

  test('a save without a name has no target path', () => {
    expect(toPickResult({ basePath: '/docs/', name: '  ' }, 'save', '/docs/').path).toBe('')
  })

  test('folder returns the folder itself', () => {
    expect(toPickResult({ basePath: '/docs/sub/' }, 'folder', '/docs/sub/')).toEqual({
      items: [],
      directory: '/docs/sub/',
      path: '/docs/sub/',
      name: '',
    })
  })

  test('file returns the single file as the target', () => {
    const result = toPickResult({ basePath: '/docs/', items: [entry('a.txt')] }, 'file', '/docs/')
    expect(result.path).toBe('/docs/a.txt')
    expect(result.name).toBe('a.txt')
    expect(result.items.map(item => item.path)).toEqual(['/docs/a.txt'])
  })

  test('files keeps the list and has no single target', () => {
    const result = toPickResult(
      { basePath: '/docs/', items: [entry('a.txt'), entry('b.txt')] },
      'files',
      '/docs/',
    )
    expect(result.items.map(item => item.name)).toEqual(['a.txt', 'b.txt'])
    expect(result.path).toBe('')
    expect(result.name).toBe('')
  })
})
