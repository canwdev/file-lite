import { describe, expect, test } from 'bun:test'
import { isThumbCacheKeyInSubtree } from './image-thumb-cache'

/**
 * Regression for the subtree test.
 *
 * Cache keys are path strings, and the string prefix `/a/foo` also hits `/a/foo.txt`: a
 * range-only move or delete would rename or drop the thumbnails of sibling entries. This
 * pins "the entry itself plus its descendants, separated by `/`".
 */
describe('isThumbCacheKeyInSubtree', () => {
  test('the entry itself hits, a sibling sharing its prefix does not', () => {
    expect(isThumbCacheKeyInSubtree('/a/foo.txt', '/a/foo.txt')).toBe(true)
    expect(isThumbCacheKeyInSubtree('/a/foo.txt.bak', '/a/foo.txt')).toBe(false)
    expect(isThumbCacheKeyInSubtree('/a/foo.txts', '/a/foo.txt')).toBe(false)
  })

  test('a folder and its children hit; a sibling folder sharing the prefix does not', () => {
    expect(isThumbCacheKeyInSubtree('/a/photos', '/a/photos')).toBe(true)
    expect(isThumbCacheKeyInSubtree('/a/photos/x.jpg', '/a/photos')).toBe(true)
    expect(isThumbCacheKeyInSubtree('/a/photos/x/y.jpg', '/a/photos')).toBe(true)
    expect(isThumbCacheKeyInSubtree('/a/photos-backup/x.jpg', '/a/photos')).toBe(false)
  })

  test('a trailing slash (listing form) does not change the verdict', () => {
    expect(isThumbCacheKeyInSubtree('/a/b/x.jpg', '/a/b/')).toBe(true)
    expect(isThumbCacheKeyInSubtree('/a/b', '/a/b/')).toBe(true)
    expect(isThumbCacheKeyInSubtree('/a/bx/x.jpg', '/a/b/')).toBe(false)
  })

  test('separators and repeated slashes are normalised as the cache key does', () => {
    expect(isThumbCacheKeyInSubtree('D:\\a\\b.jpg', 'D:/a')).toBe(true)
    expect(isThumbCacheKeyInSubtree('/a//b.jpg', '/a')).toBe(true)
  })
})
