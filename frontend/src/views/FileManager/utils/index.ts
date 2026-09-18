import type { BreadcrumbSegment } from './volume-mounts'
import { mountPaths } from '../ExplorerUI/drives'
import { canonicalizePath, PathError } from './canonical-path'
import { boundaryFor, breadcrumbSegmentsFor, canGoUpIn, getParentPathIn } from './volume-mounts'

/**
 * 把用户 / 传输层的路径归一化成 canonical 形态。
 *
 * 实现委托给 `canonicalizePath`（与后端 `fileops.CanonicalizePath` 同一张规则表），
 * 所以 UNC 的前导 `//` 会被保留。
 *
 * **这是一个修掉数据破坏的改动**：旧实现是
 * `path.replace(/\\/g, '/').replace(/\/+/g, '/')`，那个 `/\/+/g` 会把
 * `\\server\share\docs` 折叠成 `/server/share/docs`——UNC 前导双斜杠被吃掉，
 * 共享的根身份没了，后续所有按路径匹配的逻辑（挂载点、跨卷判断、后端解析）
 * 都会把这条路径当成 Unix 根下的一个普通目录。
 *
 * 非法路径（相对路径、越根）回落到「只统一分隔符」的老行为：调用方可能正在处理
 * 用户没提交的输入，这里不该抛。
 */
export function normalizePath(path: string) {
  try {
    return canonicalizePath(path)
  }
  catch (error) {
    if (error instanceof PathError) {
      return path.replace(/\\/g, '/')
    }
    throw error
  }
}

/** 与列表/导航使用的路径一致：canonical + 末尾 `/`（空路径视为 `/`） */
export function normalizeListingPath(path: string) {
  let p = normalizePath(path)
  if (!p) {
    p = '/'
  }
  if (!/\/$/.test(p)) {
    p += '/'
  }
  return p
}

/**
 * 是否允许返回上一级。
 *
 * 需要挂载表才能给出正确答案（停点是挂载点根，不是「段数为 1」），
 * 所以读的是 `drives.ts` 维护的挂载点列表。挂载表还没加载时退回路径自己的语法根，
 * 保证「上一级」不会凭空消失。
 */
export function canGoUp(path: string) {
  return canGoUpIn(path, mountPaths())
}

/** 上一级目录（listing 形态）；已在挂载边界则返回自身 */
export function getParentPath(path: string) {
  return getParentPathIn(path, mountPaths())
}

/** 面包屑：第一段 = 挂载点根 */
export function getBreadcrumbSegments(path: string): BreadcrumbSegment[] {
  return breadcrumbSegmentsFor(path, mountPaths())
}

/** 路径所在的导航边界（挂载点根，未匹配则为语法根），listing 形态 */
export function getVolumeBoundary(path: string) {
  return boundaryFor(path, mountPaths())
}

export function toggleArrayElement(arr: any[], value: any) {
  const index = arr.indexOf(value)
  if (index !== -1) {
    arr.splice(index, 1)
  }
  else {
    arr.push(value)
  }
  return arr
}

export function getLastDirName(path: string) {
  path = path.replace(/\/$/g, '')
  return path.split('/').pop()
}

export function generateTextFile(text: string, name: string) {
  // 创建一个 Blob 对象，将输入的文本转换为文本文件
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  return new File([blob], name)
}

export function getExtension(name: string) {
  if (!name || !name.includes('.') || name.startsWith('.'))
    return ''
  return name.split('.').reverse()[0].toLowerCase()
}
