/**
 * 文件内容的地址解析。
 *
 * 前端有十多处把地址塞进 `<img>` / `<video>` / `<audio>` / `<iframe>`。地址的来源
 * 收在这里一处，调用点不自己拼 `fsWebApi.getStreamUrl`。
 */
import { computed } from 'vue'
import { fs } from '@/utils/fs'

/** 解析一个文件的访问地址。 */
export function resolveFileUrl(path: string | null | undefined): string {
  return path ? fs.url(path) : ''
}

/** 同上，异步形态；服务端地址本来就能同步拿到。 */
export async function resolveFileUrlAsync(path: string | null | undefined): Promise<string> {
  return resolveFileUrl(path)
}

/** 单个文件地址的组合式用法：响应式地址，跟随路径变化。 */
export function useFileUrl(path: () => string | null | undefined) {
  return computed(() => resolveFileUrl(path()))
}

/** 一组文件地址（网格、播放列表、图集用）。 */
export function useFileUrls(paths: () => (string | null | undefined)[]) {
  return computed(() => new Map(
    paths()
      .filter((path): path is string => Boolean(path))
      .map(path => [path, resolveFileUrl(path)]),
  ))
}
