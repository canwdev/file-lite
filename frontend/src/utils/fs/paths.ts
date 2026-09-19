/**
 * 路径解析：一条路径由**哪个后端**负责。
 *
 * 这是整个前端唯一应该回答这个问题的函数。它做纯字符串判断，不认识挂载表、
 * 不碰 DOM，所以两个后端模块（甚至测试）都能安全地依赖它。
 *
 * 传进来的路径必须是 canonical 形态（`normalizePath` / `normalizeListingPath` 之后）。
 */
import { normalizeListingPath } from '../path/form'

// 路径形态转换的唯一实现在 `utils/path-form.ts`（canonical 化与后端同一张规则表）。
// 这里 re-export，让门面使用者只认 `@/utils/fs/paths` 一个入口。
export { normalizeListingPath, normalizePath } from '../path/form'

/** 挂载卷在本应用路径空间里的前缀（canonical 无尾斜杠形态）。 */
export const MOUNTED_PATH_PREFIX = '/@mounted'

/** `<id>` 只允许自己生成的形态，避免路径里出现段分隔符导致解析歧义。 */
const MOUNT_ID_PATTERN = /^[a-z0-9]+$/i

export type FsBackendKind = 'server' | 'browser'

/** 该路径是否属于「浏览器挂载的本地文件夹」命名空间。 */
export function isMountedPath(path: string | null | undefined): boolean {
  if (!path) {
    return false
  }
  const normalized = normalizeListingPath(path)
  return normalized === `${MOUNTED_PATH_PREFIX}/` || normalized.startsWith(`${MOUNTED_PATH_PREFIX}/`)
}

/** 从路径里取出挂载 id；不是挂载路径、或 id 形态非法时返回 null。 */
export function mountIdFromPath(path: string | null | undefined): string | null {
  if (!path || !isMountedPath(path)) {
    return null
  }
  const id = stripTrailingSlash(normalizeListingPath(path))
    .slice(MOUNTED_PATH_PREFIX.length + 1)
    .split('/')[0] ?? ''
  return MOUNT_ID_PATTERN.test(id) ? id : null
}

/** 一个卷的根路径（listing 形态，带结尾斜杠）。 */
export function mountRootPath(id: string): string {
  return `${MOUNTED_PATH_PREFIX}/${id}/`
}

/** 由挂载点路径构造卷根路径（listing 形态）；不是挂载路径时原样返回。 */
export function mountRootOfPath(path: string): string {
  const id = mountIdFromPath(path)
  return id ? mountRootPath(id) : path
}

/** 挂载根之下的相对路径（`a/b`，根为空串）；路径不属于该卷时返回 null。 */
export function relativePathInMount(path: string, id: string): string | null {
  const normalized = stripTrailingSlash(normalizeListingPath(path))
  const prefix = `${MOUNTED_PATH_PREFIX}/${id}`
  if (normalized === prefix) {
    return ''
  }
  if (!normalized.startsWith(`${prefix}/`)) {
    return null
  }
  return normalized.slice(prefix.length + 1)
}

/** 路径归一化成 listing 形态再去掉尾斜杠，用于取段。 */
export function stripTrailingSlash(path: string): string {
  const normalized = normalizeListingPath(path)
  return normalized === '/' ? '' : normalized.replace(/\/+$/, '')
}

/**
 * 这次操作是否必须由前端执行（任一参与路径属于挂载卷）。
 *
 * 复制 / 移动 / 删除的派发规则就靠它：后端只认识「路径 → os.*」，一条
 * `/@mounted/...` 发过去必定失败。反过来也必须保持精确——普通的服务端操作不能被
 * 误判成客户端任务，否则会绕过服务端的冲突处理与跨卷回退。
 */
export function needsClientExecution(fromPaths: string[], toPath?: string): boolean {
  return fromPaths.some(isMountedPath) || (Boolean(toPath) && isMountedPath(toPath as string))
}
