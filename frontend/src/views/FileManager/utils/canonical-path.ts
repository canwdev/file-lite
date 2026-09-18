/**
 * VFS 路径的 canonical 规则（前端副本）。
 *
 * 设计依据：`docs/design/vfs-abstraction-design.md` §4。
 * 后端唯一实现是 `backend-go/fileops/vfs_path.go`，两边必须逐条对齐——
 * 本文件与它的表驱动测试是同一个契约，改一边必须改另一边。
 *
 * 总则：VFS 路径只做字符串语义，不做文件系统语义。全链路只用 `/`，
 * 且**绝不**使用 `path`/`filepath` 之外的平台路径 API 做拼接与清理：
 * `filepath.Clean` 会吃掉 scheme，`path.Clean` 会吃掉 UNC 前导 `//` 与根尾斜杠。
 *
 * 本文件是纯函数，尚未接入任何调用点（阶段 1：零行为变更）。
 */

export class PathError extends Error {
  constructor(
    message: string,
    readonly code: 'not-absolute' | 'malformed' | 'needs-share' | 'escapes-root',
  ) {
    super(message)
    this.name = 'PathError'
  }
}

const DOT_SEGMENTS = new Set(['.', '..'])

function isAsciiAlphaChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

/** 折叠重复分隔符与 `.`、解析 `..`；越过根即报错，不静默吸收。 */
function cleanSegments(rel: string): string {
  const out: string[] = []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') {
      continue
    }
    if (seg === '..') {
      if (out.length === 0) {
        throw new PathError('path escapes its root', 'escapes-root')
      }
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

/**
 * 把路径切成「canonical 根」与「相对根的部分」。
 *
 * 识别三种根（统一转 `/` 之后判断）：
 *   `//host/share/`  UNC（也接受 `///` 写法）
 *   `C:/`            盘符（`C:` 与 `C:/` 等价）
 *   `/`              Unix
 */
export function splitRoot(input: string): { root: string, rel: string } {
  const p = input.replace(/\\/g, '/')

  if (p.startsWith('//')) {
    // 先折叠分隔符再取前两段：否则 `//server//share//docs` 会把空段当成共享名。
    const raw = p.slice(2)
    const body = p.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/')
    const parts = body.split('/')
    // 只给了主机名（`//wsl.localhost`、`//server`）时是「没写共享名」——最常见的误用，
    // 给专门的错误码与能直接照抄的写法。与后端 ErrPathNeedsShare 对齐。
    //
    // 判断必须看**剥斜杠之前**的形态：`\\\share`（空主机名）剥完是 ['share']，
    // 与 `//share` 长得一模一样，只有开头多出来的那个 `/` 能区分。
    if (parts.length < 2 || parts[0] === '' || parts[1] === '') {
      if (parts.length === 1 && parts[0] !== '' && !DOT_SEGMENTS.has(parts[0]) && !raw.startsWith('/')) {
        throw new PathError('a network path must name a share, for example //host/share', 'needs-share')
      }
      throw new PathError('path is malformed', 'malformed')
    }
    if (DOT_SEGMENTS.has(parts[0]) || DOT_SEGMENTS.has(parts[1])) {
      throw new PathError('path is malformed', 'malformed')
    }
    // 余下部分必须整体保留：UNC 后面可能有任意多段，只取 parts[2] 会丢路径。
    return { root: `//${parts[0]}/${parts[1]}/`, rel: parts.slice(2).join('/') }
  }

  // 盘符要先于 Unix 判定：Windows 路径归一化后是 `C:/Users`，不以 `/` 开头。
  if (p.length >= 2 && p[1] === ':' && isAsciiAlphaChar(p[0])) {
    // `C:Users` 没有分隔符：那是驱动器相对路径，语义依赖进程状态，拒绝而不是猜。
    if (p.length > 2 && p[2] !== '/') {
      throw new PathError('path is not absolute', 'not-absolute')
    }
    return { root: `${p[0]}:/`, rel: p.slice(2).replace(/^\/+/, '') }
  }

  if (!p.startsWith('/')) {
    throw new PathError('path is not absolute', 'not-absolute')
  }
  return { root: '/', rel: p.replace(/^\/+/, '') }
}

/**
 * 把用户/传输层的路径归一化为 canonical 形式。
 *
 * - `\` → `/`（地址栏恒用正斜杠；`\` 只出现在用户粘贴的输入里）
 * - 折叠重复分隔符、`.` / `..`；越过根报错
 * - `//host/share` 的前导 `//` 保留，且视为根
 * - 盘符根保留尾斜杠（`C:/`），非根去掉尾斜杠
 *
 * 不做的事：不改大小写（规范化只用于 `comparisonKey`）、不做 Unicode 归一化、
 * 不解析符号链接。原因见设计文档 §4.4 与 §8。
 */
export function canonicalizePath(input: string): string {
  const { root, rel } = splitRoot(input)
  const cleaned = cleanSegments(rel)
  return cleaned === '' ? root : root + cleaned
}

/**
 * 仅用于「是否同一个位置」判断的比较键。
 *
 * 键**永不当作路径使用**：回显、传输、交给后端的一律是原样大小写。
 *
 * - 盘符 → 大写（`c:` 与 `C:` 是同一个卷）
 * - UNC 主机名 → 小写；**共享名保持原样**（不同 SMB 服务器行为不一致，
 *   误判为不同只会多问一次，误判为相同会操作错位置）
 * - 其余部分原样；路径段大小写是否等价由后端 `Caps.CaseSensitive` 决定
 */
export function comparisonKey(input: string): string {
  let p = input.replace(/\\/g, '/')

  if (p.startsWith('//')) {
    const body = p.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/')
    const parts = body.split('/')
    if (parts.length >= 2 && parts[0] !== '' && parts[1] !== '') {
      p = `//${parts[0].toLowerCase()}/${parts[1]}`
      const rest = parts.slice(2).join('/')
      if (rest !== '') {
        p += `/${rest}`
      }
    }
  }
  else if (p.length >= 2 && p[1] === ':' && isAsciiAlphaChar(p[0])) {
    p = `${p[0].toUpperCase()}${p.slice(1)}`
  }

  // 统一去掉尾斜杠，让 `C:` 与 `C:/`、`//s/share` 与 `//s/share/` 同键。
  while (p.length > 1 && p.endsWith('/') && !p.endsWith('//')) {
    p = p.slice(0, -1)
  }
  return p
}

/**
 * 判断 canonical 路径 `p` 是否位于 canonical 根 `root` 之内（含 root 自身）。
 *
 * 必须是**段边界**匹配：裸 `startsWith` 会把 `/data2` 判成在 `/data` 之内。
 *
 * UNC 是**独立**的命名空间：`//server/share` 虽然字面上落在 `/` 之下，但不属于
 * 本机 Unix 根那个卷。不排除这一条的话，`/` 这个挂载点会把所有 UNC 路径都吞掉，
 * 于是网络位置被判成本机卷、并发档位与图标跟着一起错。
 */
export function isWithinRoot(p: string, root: string): boolean {
  if (p === '' || root === '') {
    return false
  }
  if (p === root) {
    return true
  }
  if (root.startsWith('/') && !root.startsWith('//') && p.startsWith('//')) {
    return false
  }
  const r = root.endsWith('/') ? root : `${root}/`
  return p.startsWith(r)
}
