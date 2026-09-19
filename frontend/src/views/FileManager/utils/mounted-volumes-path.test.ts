import { describe, expect, test } from 'bun:test'
import { isMountedPath, MOUNTED_PATH_PREFIX, mountIdFromPath, mountRootOfPath, mountRootPath, relativePathInMount } from '../ExplorerUI/mounted-volumes'

/**
 * 挂载卷的路径命名空间。
 *
 * 这层逻辑值钱的地方在于「边界」：一条路径要么明确属于某个卷、要么明确不属于，
 * 不能出现「前缀像但其实是别的东西」。误判的后果不是显示错，而是把 `/@mounted/...`
 * 发给后端（它解析不了）或把本地卷的路径当成服务端路径去操作。
 *
 * `mounted-volumes.ts` 顶部会建一个 idb store 句柄，但不会真的打开数据库
 * （`openDB` 只在首次读写时才调用），所以这里不需要 DOM。
 */

const ID = 'a1b2c3'

describe('mountRootPath', () => {
  test('给出 listing 形态（带尾斜杠）的卷根', () => {
    expect(mountRootPath(ID)).toBe('/@mounted/a1b2c3/')
  })
})

describe('isMountedPath 的命名空间判定', () => {
  test('卷根、卷内路径、命名空间本身都算挂载路径', () => {
    expect(isMountedPath('/@mounted/')).toBe(true)
    expect(isMountedPath('/@mounted/a1b2c3')).toBe(true)
    expect(isMountedPath('/@mounted/a1b2c3/')).toBe(true)
    expect(isMountedPath('/@mounted/a1b2c3/photos/a.jpg')).toBe(true)
  })

  test('后端路径与「像但不是」的路径都不算', () => {
    expect(isMountedPath('C:/Users/me')).toBe(false)
    expect(isMountedPath('/home/me/@mounted/x')).toBe(false)
    // 段边界：`/@mountedfoo` 不是命名空间
    expect(isMountedPath('/@mountedfoo/a1b2c3')).toBe(false)
    expect(isMountedPath('')).toBe(false)
    expect(isMountedPath(null)).toBe(false)
  })
})

describe('mountIdFromPath', () => {
  test('从各种形态里取出 id', () => {
    expect(mountIdFromPath('/@mounted/a1b2c3')).toBe(ID)
    expect(mountIdFromPath('/@mounted/a1b2c3/')).toBe(ID)
    expect(mountIdFromPath('/@mounted/a1b2c3/a/b.txt')).toBe(ID)
  })

  test('不属于命名空间、或 id 形态可疑时返回 null', () => {
    expect(mountIdFromPath('C:/Users/me')).toBe(null)
    expect(mountIdFromPath('/@mounted/')).toBe(null)
    // 非法字符的 id（自己生成的 id 是十六进制）
    expect(mountIdFromPath('/@mounted/a1b2@c3/a.txt')).toBe(null)
  })
})

describe('relativePathInMount', () => {
  test('卷根返回空串，子路径返回相对路径', () => {
    expect(relativePathInMount('/@mounted/a1b2c3/', ID)).toBe('')
    expect(relativePathInMount('/@mounted/a1b2c3/a/b.txt', ID)).toBe('a/b.txt')
  })

  test('路径属于别的卷时返回 null', () => {
    expect(relativePathInMount('/@mounted/ffffff/a.txt', ID)).toBe(null)
    expect(relativePathInMount('C:/a.txt', ID)).toBe(null)
  })
})

describe('mountRootOfPath', () => {
  test('收敛到卷根', () => {
    expect(mountRootOfPath('/@mounted/a1b2c3/a/b.txt')).toBe(`${MOUNTED_PATH_PREFIX}/a1b2c3/`)
  })

  test('非挂载路径原样返回', () => {
    expect(mountRootOfPath('C:/Users/me/a.txt')).toBe('C:/Users/me/a.txt')
  })
})
