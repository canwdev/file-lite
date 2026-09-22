/**
 * canonical 路径的两种形态转换。
 *
 * 这些是纯路径规则，导航（`FileManager/utils/index.ts`）与盘列表缓存（`drives.ts`）
 * 都要用，单独成文件让两边直接取用，不互相依赖。
 */
import { canonicalizePath, PathError } from './canonical-path'

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
 * 把子项名拼到父目录后面，父目录可以是 canonical（`/`、`C:/`、`//server/share/`）
 * 或 listing（带尾斜杠）形态。
 *
 * **不要写成 `` `${base}/${name}` ``**：父目录是 Unix 根时那会拼出 `//name`，
 * 而 canonical 规则里前导 `//` 是 UNC，于是 `/` 下的一级目录会被当成网络位置
 * （`//root`）——表现为点不开、预览也取不到。盘符与 UNC 必须原样保留，
 * 所以这里只做「去掉父目录尾斜杠、去掉子项前导斜杠」。
 */
export function joinPath(base: string, name: string) {
  const parent = base.replace(/\/+$/, '')
  const child = name.replace(/^\/+/, '')
  if (!child) {
    return parent === '' ? '/' : parent
  }
  return parent === '' ? `/${child}` : `${parent}/${child}`
}
