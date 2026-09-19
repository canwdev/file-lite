import type { BreadcrumbSegment } from './volume-mounts'
import { mountPaths } from '../ExplorerUI/drives'
import { mountedVolumeBoundaryPaths, mountedVolumeLabelForPath } from '../ExplorerUI/mounted-volumes'
import { boundaryFor, breadcrumbSegmentsFor, canGoUpIn, getParentPathIn, setMountedLabelLookup } from './volume-mounts'

// 面包屑第一段要显示卷标而不是 `/@mounted/<id>`：把查询注入纯匹配模块
setMountedLabelLookup(mountedVolumeLabelForPath)

export { normalizeListingPath, normalizePath } from './path-form'

/**
 * 导航边界（挂载点根）列表：后端驱动器 + 浏览器挂载卷。
 *
 * 挂载卷必须在这里出现，否则「上一级」会从卷根继续爬到 `/@mounted/` 这个并不存在
 * 的位置；而它又不能进 `drives.ts` 的 `driveList`（那份列表是后端跨卷判定的输入）。
 * 所以两边各取所需：跨卷判定只看后端卷，导航边界两个都看。
 */
function navigationBoundaryPaths(): readonly string[] {
  return [...mountPaths(), ...mountedVolumeBoundaryPaths()]
}

/**
 * 是否允许返回上一级。
 *
 * 需要挂载表才能给出正确答案（停点是挂载点根，不是「段数为 1」），
 * 所以读的是 `drives.ts` 维护的挂载点列表。挂载表还没加载时退回路径自己的语法根，
 * 保证「上一级」不会凭空消失。
 */
export function canGoUp(path: string) {
  return canGoUpIn(path, navigationBoundaryPaths())
}

/** 上一级目录（listing 形态）；已在挂载边界则返回自身 */
export function getParentPath(path: string) {
  return getParentPathIn(path, navigationBoundaryPaths())
}

/** 面包屑：第一段 = 挂载点根 */
export function getBreadcrumbSegments(path: string): BreadcrumbSegment[] {
  return breadcrumbSegmentsFor(path, navigationBoundaryPaths())
}

/** 路径所在的导航边界（挂载点根，未匹配则为语法根），listing 形态 */
export function getVolumeBoundary(path: string) {
  return boundaryFor(path, navigationBoundaryPaths())
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
