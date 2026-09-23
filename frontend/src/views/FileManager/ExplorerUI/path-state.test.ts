import type { PathState } from './path-state'
import { describe, expect, test } from 'bun:test'
import { SortType } from '../../../types/server'
import { listingParent } from '../utils/volume-mounts'
import { resolveInheritedPathState } from './path-state'

const MOUNTS = ['/', '/data', '//server/share']

type ResolvableKey = 'sortMode' | 'groupField' | 'groupDesc'

function resolve(state: Record<string, PathState>, path: string, key: ResolvableKey) {
  return resolveInheritedPathState(state, path, key, MOUNTS)
}

describe('resolveInheritedPathState', () => {
  test('目录自己的设置优先', () => {
    const state: Record<string, PathState> = {
      '/data/a/': { sortMode: SortType.size },
      '/data/': { sortMode: SortType.nameDesc },
    }
    expect(resolve(state, '/data/a/', 'sortMode')).toBe(SortType.size)
  })

  test('自身没有就取最近一个手动设置过的祖先', () => {
    const state: Record<string, PathState> = {
      '/data/': { sortMode: SortType.lastModifiedDesc },
      '/': { sortMode: SortType.nameDesc },
    }
    expect(resolve(state, '/data/a/b/', 'sortMode')).toBe(SortType.lastModifiedDesc)
  })

  test('不跨挂载点继承', () => {
    // / 上有设置，但 /data/a 的边界是 /data —— 不该继承到 /
    expect(resolve({ '/': { sortMode: SortType.nameDesc } }, '/data/a/', 'sortMode')).toBeUndefined()
    // 挂载点根自己的设置会继承给它的子目录
    expect(resolve({ '/data/': { sortMode: SortType.sizeDesc } }, '/data/a/b/', 'sortMode')).toBe(SortType.sizeDesc)
  })

  test('盘符根与 UNC 共享根同样适用', () => {
    expect(resolve({ 'C:/': { groupField: 'name' } }, 'C:/Users/me/', 'groupField')).toBe('name')
    expect(resolve({ '//server/share/': { sortMode: SortType.birthTime } }, '//server/share/docs/', 'sortMode')).toBe(SortType.birthTime)
  })

  test('分组字段与方向各自独立继承', () => {
    const state: Record<string, PathState> = {
      '/data/': { groupField: 'size', groupDesc: true },
      '/data/a/': { groupDesc: false },
    }
    // a 自己只钉了方向，字段继续跟随祖先
    expect(resolve(state, '/data/a/', 'groupField')).toBe('size')
    expect(resolve(state, '/data/a/', 'groupDesc')).toBe(false)
  })

  test('没有任何设置时返回 undefined', () => {
    expect(resolve({}, '/data/a/', 'sortMode')).toBeUndefined()
    expect(resolve({}, '', 'sortMode')).toBeUndefined()
  })
})

describe('listingParent', () => {
  test('剥掉最后一段（listing 形态）', () => {
    expect(listingParent('/data/a/b/')).toBe('/data/a/')
    expect(listingParent('/data/a/')).toBe('/data/')
  })

  test('停在各种根上', () => {
    expect(listingParent('/')).toBe('/')
    expect(listingParent('/data/')).toBe('/')
    expect(listingParent('C:/')).toBe('C:/')
    expect(listingParent('//server/share/')).toBe('//server/share/')
  })
})
