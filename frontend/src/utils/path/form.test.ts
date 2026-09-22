import { describe, expect, test } from 'bun:test'
import { joinPath, normalizePath } from './form'

/**
 * 拼子项路径的回归。
 *
 * 背景：各处曾经直接写 `` `${basePath}/${name}` ``，当 basePath 是 Unix 根（`/`）时
 * 会拼出 `//root`；canonical 规则把前导 `//` 当 UNC，于是 `/` 下的一级目录被判成
 * 「没写共享名的网络位置」，点不开、预览也取不到（见 docs/design/vfs-abstraction-design.md §4）。
 */
describe('joinPath', () => {
  test('Unix 根下不能拼出前导双斜杠', () => {
    expect(joinPath('/', 'root')).toBe('/root')
    expect(normalizePath(joinPath('/', 'root'))).toBe('/root')
    // 反例：直接拼字符串会得到 UNC 形态，normalizePath 只能原样返回
    expect(normalizePath(`${'/'}/${'root'}`)).toBe('//root')
  })

  test('尾斜杠形态的父目录', () => {
    expect(joinPath('/a/b/', 'c')).toBe('/a/b/c')
    expect(joinPath('/a/b', 'c')).toBe('/a/b/c')
  })

  test('子项自带前导斜杠', () => {
    expect(joinPath('/', '/root')).toBe('/root')
    expect(joinPath('/a', '/b')).toBe('/a/b')
  })

  test('盘符保留字母，不产生双斜杠', () => {
    expect(joinPath('D:', 'Users')).toBe('D:/Users')
    expect(joinPath('D:/', 'Users')).toBe('D:/Users')
  })

  test('UNC 前导 // 原样保留', () => {
    expect(joinPath('//server/share/', 'docs')).toBe('//server/share/docs')
    expect(joinPath('//server/share', 'docs')).toBe('//server/share/docs')
    expect(normalizePath(joinPath('//server/share/', 'docs'))).toBe('//server/share/docs')
  })

  test('父目录为空按根处理', () => {
    expect(joinPath('', 'x')).toBe('/x')
  })
})
