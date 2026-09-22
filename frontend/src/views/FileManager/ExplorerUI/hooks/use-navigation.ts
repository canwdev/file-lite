import type { Ref, WritableComputedRef } from 'vue'
import type { FsDirChange, IEntry } from '@/types/server'
import { subscribeFsChanged } from '@/store/tasks'
import { NavigationHistory } from '@/views/FileManager/utils/navigation-history.ts'
import { canGoUp, getLastDirName, getParentPath, normalizeListingPath, normalizePath } from '../../utils'
import { seedFolderListing } from '../folder-listing'
import { useFavourites } from './use-favourites'
import { useOpener } from './use-opener'

export function useNavigation({ basePath, getListFn, flatListing, beforeOpenPath }: {
  basePath: WritableComputedRef<string>
  getListFn: (options?: { signal?: AbortSignal }) => Promise<IEntry[]>
  /** 平铺视图下列出的是整棵子树，不能写进「这一层的子项」缓存，补丁也必须整表重拉。 */
  flatListing?: Ref<boolean>
  /**
   * 即将切到 `path` 时调用（含后退 / 上一级）。可同步关掉 Branch view；
   * 返回 `{ forceRefresh: true }` 时即使目录未变也重拉列表。
   */
  beforeOpenPath?: (ctx: { path: string, sameDir: boolean }) => void | { forceRefresh?: boolean }
}) {
  const files = ref<IEntry[]>([])

  const basePathNormalized = computed(() => normalizeListingPath(basePath.value))
  const isLoading = ref(false)
  /**
   * 上一次列目录失败的原因；空串表示没有错误。
   *
   * 与 toast 互补：toast 说完就消失，这个值留给列表区的错误空状态，用户回头
   * 还能看到目录为什么打不开，并能就地重试。
   */
  const loadError = ref('')
  const navigationHistory = ref<NavigationHistory | null>(null)
  const highlightFolderName = ref<string | null>(null)
  /** files 当前对应的目录，用来区分「同目录重载」和「切换到别的目录」。 */
  const loadedPath = ref('')
  let refreshController: AbortController | null = null
  let refreshSeq = 0

  const handleRefresh = async (isUpdateHistory = true) => {
    refreshController?.abort()
    const controller = new AbortController()
    refreshController = controller
    const currentSeq = ++refreshSeq
    // 同目录重载保留旧列表到新数据到达：否则所有行（含虚拟滚动位置）会先卸载再重建。
    // 切换目录必须清空，否则新地址栏会配着上一个目录的行。
    let sameDir = false

    try {
      basePath.value = basePathNormalized.value
      // 空路径 = 「还没有选中位置」。这不是 `/`：默认进根目录会把用户直接丢到
      // 整个文件系统的顶上，而卷列表才是真正该从这里开始的界面。
      // 面板会渲染挂载点列表，这里不发请求、也不清空列表（没有「上一个目录」可言）。
      if (!basePath.value) {
        isLoading.value = false
        return
      }
      // 每次刷新先清掉上一次的错误：失败后重试成功时，错误空状态必须消失。
      loadError.value = ''
      const target = normalizeListingPath(basePath.value)
      sameDir = loadedPath.value === target

      isLoading.value = true
      if (!sameDir) {
        files.value = []
      }

      const list = (await getListFn({ signal: controller.signal })) as unknown as IEntry[]
      if (controller.signal.aborted || currentSeq !== refreshSeq) {
        return
      }

      // 列表内容没变就不动 files：数组引用不变，下游 computed 与行组件都不会重算 / 重渲染。
      if (!sameDir || !sameListing(files.value, list)) {
        files.value = list
        // 当前目录列表是最新鲜的，写入目录子项缓存供预览/下拉复用
        if (!flatListing?.value)
          seedFolderListing(basePath.value, list)
      }
      else {
        // 内容一致：继续用同一份数组（含对象引用），只确认缓存可用
        if (!flatListing?.value)
          seedFolderListing(basePath.value, files.value)
      }
      loadedPath.value = target

      if (!navigationHistory.value) {
        navigationHistory.value = new NavigationHistory(basePath.value)
      }
      else if (isUpdateHistory) {
        navigationHistory.value.go(basePath.value)
      }
    }
    catch (e: any) {
      if (isAbortError(e)) {
        return
      }
      console.error(e)
      // 错误同时进列表区的空状态（见 loadError）：toast 会消失，空状态不会。
      loadError.value = readErrorMessage(e)
      // 同目录重载失败时保留旧列表，别因为一次瞬时错误把它清空。
      // 平铺失败例外：旧列表是「这一层」的，不是平铺结果，留着会让人以为 Branch view 成功了。
      if (!sameDir || flatListing?.value) {
        files.value = []
      }
      if (flatListing?.value && loadError.value) {
        window.$message?.error(loadError.value)
      }
    }
    finally {
      if (currentSeq === refreshSeq) {
        isLoading.value = false
        refreshController = null
      }
    }
  }

  onBeforeUnmount(() => {
    refreshController?.abort()
  })

  // 服务端在目录变化后广播 fs changed：带上条目级 changes 就原地打补丁，
  // 只有拿不到 changes 时才退回整目录刷新。上传、建目录、重命名与任务结束都走这条。
  const unsubscribeFsChanged = subscribeFsChanged((paths, changes) => {
    if (!paths.length && !changes.length) {
      return
    }
    const current = basePathNormalized.value
    const listingUnderCurrent = (path: string) => {
      const normalized = normalizeListingPath(path)
      return normalized === current || normalized.startsWith(`${current}/`)
    }
    // 平铺视图的名字是相对路径，条目级补丁对不上；子目录里的改动也要反映进来。
    if (flatListing?.value) {
      if (paths.some(listingUnderCurrent) || changes.some(item => listingUnderCurrent(item.dir)))
        void handleRefresh(false)
      return
    }
    const change = changes.find(item => normalizeListingPath(item.dir) === current)
    // 整目录刷新进行中不打补丁：这份列表马上会被整份替换。
    // 不能看 isLoading——新建、重命名、粘贴也会把它置上，那些结果要靠补丁出现在发起操作的列表里。
    if (change && !refreshController) {
      applyEntryChange(change)
      return
    }
    if (paths.some(path => normalizeListingPath(path) === current)) {
      void handleRefresh(false)
    }
  })
  onBeforeUnmount(unsubscribeFsChanged)

  /**
   * 用条目级变化原地改当前列表。
   * 排序与隐藏过滤都在展示层的 computed 里做，所以这里只改原始列表；
   * 选区由 use-selection 按名字自动 reconcile。
   */
  function applyEntryChange(change: Pick<FsDirChange, 'added' | 'updated' | 'removed'>) {
    const removed = change.removed ?? []
    const upserts = [...(change.added ?? []), ...(change.updated ?? [])]
    if (!removed.length && !upserts.length) {
      return
    }
    const byName = new Map(files.value.map(entry => [entry.name, entry]))
    for (const name of removed) {
      byName.delete(name)
    }
    for (const entry of upserts) {
      byName.set(entry.name, entry)
    }
    const next = [...byName.values()]
    // 补丁没带来实际变化（例如服务端把同一个未变条目又报了一次）就别换数组引用
    if (sameListing(files.value, next)) {
      return
    }
    files.value = next
    if (!flatListing?.value)
      seedFolderListing(basePath.value, next)
  }

  /* 历史记录功能 START */
  const goBack = async () => {
    const hist = navigationHistory.value
    if (!hist) {
      return
    }
    const currentSegments = basePath.value.split('/').filter(i => !!i)
    highlightFolderName.value = currentSegments[currentSegments.length - 1] || null
    const item = hist.back()
    if (!item?.path) {
      highlightFolderName.value = null
      return
    }
    await handleOpenPath(item.path, false)
  }
  const goForward = async () => {
    const hist = navigationHistory.value
    if (!hist) {
      return
    }
    const item = hist.forward()
    if (!item?.path) {
      return
    }
    await handleOpenPath(item.path, false)
  }
  /* 历史记录功能 END */

  // 是否允许返回上一级
  const allowUp = computed(() => canGoUp(basePath.value))
  const goUp = async () => {
    if (!allowUp.value) {
      return
    }
    highlightFolderName.value = getLastDirName(basePath.value) || null
    await handleOpenPath(getParentPath(basePath.value), true)
  }
  const handleOpenPath = async (path: string, isUpdateHistory: boolean = true, forceRefresh: boolean = false) => {
    const sameDir = normalizeListingPath(path) === basePathNormalized.value
    const hint = beforeOpenPath?.({ path, sameDir })
    if (hint?.forceRefresh)
      forceRefresh = true
    if (sameDir && !forceRefresh) {
      return
    }
    basePath.value = path
    await handleRefresh(isUpdateHistory)
  }
  const { openFile } = useOpener(basePath)

  // 打开文件或文件夹
  const handleOpen = async ({ item, list = [], openWith }: { item: IEntry, list: IEntry[], openWith?: string }) => {
    const path = normalizePath(`${basePath.value}/${item.name}`)
    if (item.isDirectory) {
      await handleOpenPath(path, true)
    }
    else {
      openFile(
        {
          item,
          openWith,
        },
        list,
      )
    }
  }

  const { starList } = useFavourites()

  return {
    isLoading,
    loadError,
    files,
    handleOpen,
    handleRefresh,
    applyEntryChange,
    basePathNormalized,
    starList,
    handleOpenPath,
    navigationHistory,
    goBack,
    goForward,
    allowUp,
    goUp,
    basePath,
    highlightFolderName,
  }
}

/**
 * 两份目录列表是否内容一致。
 *
 * 一致时调用方可以继续沿用旧数组（对象引用不变），下游 computed 与行组件都不会重算；
 * 只比较列表会展示 / 排序用到的字段，顺序无关（展示前都会重新排序）。
 */
function sameListing(a: IEntry[], b: IEntry[]): boolean {
  if (a === b) {
    return true
  }
  if (a.length !== b.length) {
    return false
  }
  const map = new Map(a.map(entry => [entry.name, entry]))
  for (const entry of b) {
    const prev = map.get(entry.name)
    if (!prev || !sameEntry(prev, entry)) {
      return false
    }
  }
  return true
}

function sameEntry(a: IEntry, b: IEntry): boolean {
  return (
    a.ext === b.ext
    && a.isDirectory === b.isDirectory
    && a.isLink === b.isLink
    && a.hidden === b.hidden
    && a.lastModified === b.lastModified
    && a.birthtime === b.birthtime
    && a.size === b.size
    && a.error === b.error
  )
}

function isAbortError(error: unknown) {
  return (
    typeof error === 'object'
    && error !== null
    && ('code' in error || 'name' in error)
    && ((error as { code?: string }).code === 'ERR_CANCELED' || (error as { name?: string }).name === 'CanceledError')
  )
}

/**
 * 从请求失败里取出给用户看的一句话。
 *
 * 优先用后端 `{ message }`（401 / 400 / 404 / 503 都是这个形状，见 utils/service.ts
 * 的拦截器），否则退回 axios 自己的 message。兜底文案是有意的：宁可说
 * 「打不开这个目录」，也不要把 `Network Error` 这种英文原始错误甩给用户。
 */
function readErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data
  if (data && typeof data.message === 'string' && data.message) {
    return data.message
  }
  const message = (error as { message?: unknown })?.message
  if (typeof message === 'string' && message) {
    return message
  }
  return 'Failed to load this folder.'
}
