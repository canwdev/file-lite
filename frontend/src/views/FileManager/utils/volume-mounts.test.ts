import { describe, expect, test } from 'bun:test'
import { boundaryDisplayName } from './volume-mounts'

describe('boundaryDisplayName', () => {
  test('a drive-letter root keeps its letter', () => {
    expect(boundaryDisplayName('D:/', [{ path: 'D:/', label: 'Data' }])).toBe(null)
    expect(boundaryDisplayName('D:', [{ path: 'D:', label: 'Data' }])).toBe(null)
  })

  test('a labeled mount inside a drive still shows its label', () => {
    // Home and a network location are not drive roots even on Windows: `D:/work`
    // starts with a drive letter but is the mount itself.
    expect(boundaryDisplayName('D:/work/', [{ path: 'D:/work', label: 'Data' }])).toBe('Data')
    expect(boundaryDisplayName('/home/me/', [{ path: '/home/me', label: 'Home' }])).toBe('Home')
  })

  test('falls back to the path when the label adds nothing or the mount is missing', () => {
    expect(boundaryDisplayName('/mnt/data/', [{ path: '/mnt/data', label: '/mnt/data' }])).toBe(null)
    expect(boundaryDisplayName('', [{ path: '/x', label: '' }])).toBe(null)
    expect(boundaryDisplayName('/unknown/', [])).toBe(null)
  })
})
