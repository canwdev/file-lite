/**
 * 挂载点的**纯匹配**逻辑。
 *
 * 这里只回答一个问题：一条 canonical 路径落在哪个挂载点里？挂载点由调用方传进来，
 * 所以它是纯函数，可以在没有 Vue / 没有网络的情况下被完全覆盖。
 *
 * 挂载点就是「路径解析的边界」——盘符、UNC 共享、Home、Linux 的 /mnt/xxx。
 * 界面上「能不能再往上」、面包屑的第一段、拖拽时判断是否跨卷，全都以它为界
 * （见 docs/design/vfs-abstraction-design.md §3、§5.2）。
 */
import { isWithinRoot, PathError, splitRoot } from '../../../utils/path/canonical-path'
import { normalizeListingPath, normalizePath } from '../../../utils/path/form'

export interface BreadcrumbSegment {
  name: string
  /** listing 形态（带尾斜杠），可直接导航 */
  path: string
}

/** 拆成 canonical 根（带尾斜杠）与相对段。非法路径回落到「按字符串切」。 */
function rootAndSegments(path: string): { root: string, segments: string[] } {
  const canonical = normalizePath(path)
  try {
    const { root, rel } = splitRoot(canonical)
    return { root, segments: rel === '' ? [] : rel.split('/') }
  }
  catch (error) {
    if (!(error instanceof PathError)) {
      throw error
    }
    // 非法路径（相对路径、越根）：地址栏里正在被编辑的输入可能就长这样，
    // 不该让面包屑整块炸掉，退回按 `/` 切。
    const trimmed = canonical.replace(/^\/+|\/+$/g, '')
    return { root: '/', segments: trimmed === '' ? [] : trimmed.split('/') }
  }
}

/** 用根 + 段拼回 listing 形态。 */
function joinListing(root: string, segments: string[]): string {
  if (segments.length === 0) {
    return root
  }
  return `${root}${segments.join('/')}/`
}

/**
 * 路径语法意义上的根：`/`、`C:/`、`//server/share/`。
 *
 * 这是「挂载点一个都没匹配上」时的兜底——绝不能因为挂载表还没加载就说一条路径
 * 已经在根上了，那会让「上一级」在任意目录下凭空消失。
 */
export function syntacticRoot(path: string): string {
  const { root } = rootAndSegments(path)
  return root
}

/**
 * 命中的挂载点根（最长前缀 + **段边界**），listing 形态；没命中返回 null。
 *
 * 段边界是必须的：裸 `startsWith` 会把 `/data2` 判成落在挂载点 `/data` 之内，
 * 于是 `/data2` 里的文件会被当成在 `/data` 这个卷上——跨卷判断错了，
 * 拖拽就会把跨卷复制做成同卷移动（见阶段 4 的回归用例）。
 */
export function findMountRoot(path: string, mounts: readonly string[]): string | null {
  const target = normalizePath(path)
  let best: string | null = null
  for (const mount of mounts) {
    const root = normalizePath(mount)
    if (!isWithinRoot(target, root)) {
      continue
    }
    if (best === null || root.length > best.length) {
      best = root
    }
  }
  return best === null ? null : normalizeListingPath(best)
}

/**
 * 导航边界：命中了挂载点就是它，没命中就是路径自己的语法根。
 *
 * 注意它不是「往上取一层」的意思——那由 `getParentPathIn` 负责。
 */
export function boundaryFor(path: string, mounts: readonly string[]): string {
  return findMountRoot(path, mounts) ?? syntacticRoot(path)
}

/**
 * 是否允许返回上一级。停点是**挂载点根**，不是「段数为 1」。
 *
 * `//server/share` 是共享根，字面上还能切出 `//server`，但那不是可导航位置；
 * `C:/` 同理。所以这里比的是「比边界更深」，而不是「段数大于几」。
 */
export function canGoUpIn(path: string, mounts: readonly string[]): boolean {
  const canonical = normalizePath(path)
  if (canonical === '' || canonical === '/') {
    return false
  }
  const boundary = boundaryFor(canonical, mounts)
  if (canonical === boundary.replace(/\/+$/, '')) {
    return false
  }
  const target = rootAndSegments(canonical)
  const root = rootAndSegments(boundary)
  return target.root === root.root && target.segments.length > root.segments.length
}

/** 上一级目录（listing 形态）；已经在边界上则返回自身。 */
export function getParentPathIn(path: string, mounts: readonly string[]): string {
  const canonical = normalizePath(path)
  if (!canGoUpIn(canonical, mounts)) {
    return normalizeListingPath(canonical)
  }
  const { root, segments } = rootAndSegments(canonical)
  return joinListing(root, segments.slice(0, -1))
}

/**
 * 面包屑：第一段是**挂载点根**，之后每深一级各一段。
 *
 * 前导 `//` 必须活着（UNC），所以不能按 `split('/')` 拼接后再 `replace(/\/+/g,'/')`
 * ——那一步会把 `//server/share` 塌成 `/server/share`。
 */
export function breadcrumbSegmentsFor(path: string, mounts: readonly string[]): BreadcrumbSegment[] {
  const raw = (path || '').trim()
  if (!raw) {
    return []
  }
  const canonical = normalizePath(raw)
  const boundary = boundaryFor(canonical, mounts)
  const target = rootAndSegments(canonical)
  const root = rootAndSegments(boundary)
  // 路径比边界浅或不同根（挂载表与路径不一致时的兜底）：只给根这一段
  const rest = target.root === root.root ? target.segments.slice(root.segments.length) : []
  const rootName = boundary.replace(/\/+$/, '') || '/'

  const out: BreadcrumbSegment[] = [{ name: rootName, path: boundary }]
  for (let i = 0; i < rest.length; i++) {
    out.push({ name: rest[i], path: joinListing(boundary, rest.slice(0, i + 1)) })
  }
  return out
}

/**
 * 面包屑某一段的下拉里，「当前目录」对应哪一项。
 *
 * 返回那一项在 `segPath` 子目录列表里的**名字**（不是下标）：列表按目录自身的排序
 * 规则产出，调用方拿名字去找下标才不会因为排序规则不同而错位。
 *
 * 往下走时的中间目录也算：从 `D:/` 的下拉里打开菜单时，当前目录可能是 `D:/a/b/c`，
 * 沿途经过的 `a` 就是这一级要标出来的那一项。
 *
 * 当前目录就是该段自身（或不在其下）时返回 null——没有可高亮的项。
 */
export function currentChildNameFor(segPath: string, currentPath: string): string | null {
  const base = normalizeListingPath(segPath)
  const current = normalizeListingPath(currentPath)
  if (current === base || !current.startsWith(base)) {
    return null
  }
  return current.slice(base.length).split('/').filter(Boolean)[0] ?? null
}
