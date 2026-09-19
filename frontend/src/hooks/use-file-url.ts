/**
 * 文件内容的地址解析：服务端路径给 `/api/files/stream`，挂载卷路径给 objectURL。
 *
 * 前端有十多处把 `fsWebApi.getStreamUrl(path)` 直接塞进 `<img>` / `<video>` / `<audio>`
 * / `<iframe>`。挂载卷的内容在浏览器里，那条 URL 不存在，所以这些地方必须改走
 * `resolveFileUrl`；本模块就是那一个收口处。
 *
 * 三条约定：
 *
 * - **只给挂载卷做 objectURL**。服务端文件继续用 HTTP 地址，浏览器可以 Range 请求、
 *   可以缓存；转成 blob 只会把整个文件先拉进内存。
 * - **解析是异步的，但接口是同步的**。第一次调用返回空串，读完之后
 *   `fileUrlVersion` 变化，依赖它的 computed 重算就能拿到地址。这样十几处调用点
 *   不必全部改成 `await`。
 * - **objectURL 按路径引用计数**。同一个文件可能同时出现在网格缩略图和查看器里，
 *   谁先卸载都不能把别人正在用的 URL 撤销掉。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { fsWebApi } from '@/api/filesystem'
import { isMountedPath } from '@/views/FileManager/ExplorerUI/mounted-volumes'

interface CachedUrl {
  url: string
  /** 有多少个消费者正在用 */
  refs: number
}

/** 路径 → 已创建的 objectURL。 */
const objectUrls = new Map<string, CachedUrl>()
/** 路径 → 正在解析中的 promise（并发去重）。 */
const inflight = new Map<string, Promise<string>>()
/** 解析失败的原因（调用方据此显示错误而不是一直空白）。 */
const failures = new Map<string, string>()

/** 已解析完成的地址版本号：让依赖它的 computed 能重算。 */
export const fileUrlVersion = ref(0)

/**
 * 解析一个文件的访问地址。
 *
 * 挂载卷文件第一次调用返回空串（objectURL 还没读出来），读完之后
 * `fileUrlVersion` 变化，调用方重算即可拿到地址。
 */
export function resolveFileUrl(path: string | null | undefined): string {
  if (!path) {
    return ''
  }
  if (!isMountedPath(path)) {
    return fsWebApi.getStreamUrl(path)
  }

  const cached = objectUrls.get(path)
  if (cached) {
    return cached.url
  }
  if (!inflight.has(path)) {
    void readMountedObjectUrl(path)
  }
  return ''
}

/**
 * 解析并**保留**一个挂载卷文件的地址（引用计数 +1）。
 *
 * 组件用这个而不是 `resolveFileUrl`，卸载时配对调用 `releaseFileUrl`。
 */
export function retainFileUrl(path: string | null | undefined): string {
  if (!path || !isMountedPath(path)) {
    return resolveFileUrl(path)
  }
  const cached = objectUrls.get(path)
  if (cached) {
    cached.refs += 1
    return cached.url
  }
  if (!inflight.has(path)) {
    void readMountedObjectUrl(path)
  }
  return ''
}

/**
 * 同上，但等地址真正就绪再返回。
 *
 * 给那些「拿到地址就要立刻用」的一次性场景（ArtPlayer 的 `switchUrl`、
 * 字幕切换）：它们没有响应式重算的机会，只能等一次。
 */
export async function resolveFileUrlAsync(path: string | null | undefined): Promise<string> {
  if (!path) {
    return ''
  }
  if (!isMountedPath(path)) {
    return fsWebApi.getStreamUrl(path)
  }
  const cached = objectUrls.get(path)
  if (cached) {
    cached.refs += 1
    return cached.url
  }
  const pending = inflight.get(path)
  if (pending) {
    return await pending
  }
  return await readMountedObjectUrl(path)
}

/** 该路径的解析是否失败过（挂载卷被移走、权限被收回等）。 */
export function fileUrlError(path: string): string | undefined {
  return failures.get(path)
}

async function readMountedObjectUrl(path: string) {
  const task = (async () => {
    const { readMountedFile } = await import('@/views/FileManager/ExplorerUI/browser-fs')
    const file = await readMountedFile(path)
    const url = URL.createObjectURL(file)
    objectUrls.set(path, { url, refs: 0 })
    failures.delete(path)
    fileUrlVersion.value += 1
    return url
  })()
    .catch((error) => {
      failures.set(path, error instanceof Error ? error.message : String(error))
      fileUrlVersion.value += 1
      throw error
    })
    .finally(() => {
      inflight.delete(path)
    })

  inflight.set(path, task)
  return task
}

/**
 * 释放一次引用；归零才真正撤销 objectURL。
 *
 * 传 `force` 表示「这个文件确定不再出现在任何地方了」（如删除、退出），
 * 忽略其他消费者。
 */
export function releaseFileUrl(path: string, force = false) {
  const cached = objectUrls.get(path)
  if (!cached) {
    failures.delete(path)
    return
  }
  cached.refs -= 1
  if (force || cached.refs <= 0) {
    URL.revokeObjectURL(cached.url)
    objectUrls.delete(path)
  }
  failures.delete(path)
}

/** 撤销不再在用的那批路径，保留 `keep` 里的（列表刷新时用）。 */
export function releaseFileUrlsExcept(keep: Iterable<string>) {
  const keepSet = new Set(keep)
  for (const path of [...objectUrls.keys()]) {
    if (!keepSet.has(path)) {
      releaseFileUrl(path, true)
    }
  }
}

/** 撤销全部 objectURL（组件树整体卸载 / 退出登录时用）。 */
export function releaseAllFileUrls() {
  for (const path of [...objectUrls.keys()]) {
    releaseFileUrl(path, true)
  }
}

/**
 * 单个文件地址的组合式用法：响应式地址 + 自动释放。
 *
 * ```ts
 * const src = useFileUrl(() => props.appParams?.absPath)
 * ```
 *
 * 保留/释放在 watch 里成对发生，**不能放进 computed**：computed 会因为
 * `fileUrlVersion` 变化而重算，每次重算都 retain 会把引用计数越加越高，URL 永不释放。
 */
export function useFileUrl(path: () => string | null | undefined) {
  const current = ref<string | null>(null)

  watch(
    path,
    (next, _previous, onCleanup) => {
      const value = next ?? null
      current.value = value
      if (!value) {
        return
      }
      retainFileUrl(value)
      onCleanup(() => releaseFileUrl(value))
    },
    { immediate: true },
  )

  return computed(() => {
    // 读一次版本号，objectURL 解析完成后触发重算
    void fileUrlVersion.value
    return current.value ? resolveFileUrl(current.value) : ''
  })
}

/**
 * 一组文件地址（网格、播放列表、图集用）。
 *
 * `paths` 返回当前需要保留的那批路径；变化时自动释放不再需要的、保留新出现的。
 */
export function useFileUrls(paths: () => (string | null | undefined)[]) {
  const current = ref<string[]>([])

  watch(
    paths,
    (next) => {
      const wanted = next.filter((path): path is string => Boolean(path))
      const previous = current.value
      for (const path of previous) {
        if (!wanted.includes(path)) {
          releaseFileUrl(path)
        }
      }
      for (const path of wanted) {
        if (!previous.includes(path)) {
          retainFileUrl(path)
        }
      }
      current.value = wanted
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    for (const path of current.value) {
      releaseFileUrl(path)
    }
    current.value = []
  })

  return computed(() => {
    // 同上：版本号驱动的重算，只读不 retain
    void fileUrlVersion.value
    return new Map(current.value.map(path => [path, resolveFileUrl(path)]))
  })
}
