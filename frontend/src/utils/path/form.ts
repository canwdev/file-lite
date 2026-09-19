/**
 * canonical 路径的两种形态转换。
 *
 * 单独成文件是为了打断一处循环依赖：`utils/index.ts` 需要读挂载卷作为导航边界
 * （导入 `mounted-volumes.ts`），而挂载卷那条路径又要用这里归一化路径。把这两个
 * 纯函数抽出来，两边都从这里取，模块图就没有环了。
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
