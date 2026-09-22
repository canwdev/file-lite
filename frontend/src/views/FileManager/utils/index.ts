import type { BreadcrumbSegment } from './volume-mounts'
import { mountLabelFor, mountPaths } from '../ExplorerUI/drives'
import { boundaryFor, breadcrumbSegmentsFor, canGoUpIn, getParentPathIn } from './volume-mounts'

export { joinPath, normalizeListingPath, normalizePath } from '../../../utils/path/form'

/**
 * 导航边界（挂载点根）列表。
 *
 * 停点是**挂载点根**，不是「段数为 1」：`D:/` 不能再上，`//server/share/` 不能上到
 * `//server/`。列表就是后端盘列表，跨卷判定与导航边界共用它。
 */
function navigationBoundaryPaths(): readonly string[] {
  return mountPaths()
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

/**
 * 面包屑：第一段 = 挂载点根。
 *
 * 挂载点的名字优先用后端给的 Label（`/home/user` → `Home`、UNC / WSL 网络位置、
 * 配置的允许根），这样侧边栏与地址栏对同一个位置叫同一个名字；盘符根与没有
 * Label 的挂载点仍然是路径本身。见 `volume-mounts.ts` 的 `boundaryDisplayName`。
 * 只有 `name` 变了，`path` 仍是真实路径。
 */
export function getBreadcrumbSegments(path: string): BreadcrumbSegment[] {
  const segments = breadcrumbSegmentsFor(path, navigationBoundaryPaths())
  const root = segments[0]
  if (!root) {
    return segments
  }
  const label = mountLabelFor(root.path)
  return label ? [{ name: label, path: root.path }, ...segments.slice(1)] : segments
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
