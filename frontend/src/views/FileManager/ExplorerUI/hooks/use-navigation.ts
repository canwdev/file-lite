import type { FsDirChange, IEntry } from '@/types/server'
import type { OpenWithEnum } from '@/views/Apps/apps'
import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { useRemoteSetting } from '@/hooks/use-remote-setting'
import { subscribeFsChanged } from '@/store/tasks'
import { NavigationHistory } from '@/views/FileManager/utils/navigation-history.ts'
import { canGoUp, getLastDirName, getParentPath, normalizeListingPath, normalizePath, toggleArrayElement } from '../../utils'
import { seedFolderListing } from '../folder-listing'
import { useOpener } from './use-opener'

export function useNavigation({ getListFn }: { getListFn: (options?: { signal?: AbortSignal }) => Promise<IEntry[]> }) {
  const files = ref<IEntry[]>([])

  const basePath = useStorage(LsKeys.NAV_PATH, '', localStorage, {
    listenToStorageChanges: false,
  })
  const basePathNormalized = computed(() => normalizeListingPath(basePath.value))
  const isLoading = ref(false)
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
      if (!basePath.value) {
        basePath.value = '/'
      }
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
        seedFolderListing(basePath.value, list)
      }
      else {
        // 内容一致：继续用同一份数组（含对象引用），只确认缓存可用
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
      // 同目录重载失败时保留旧列表，别因为一次瞬时错误把它清空
      if (!sameDir) {
        files.value = []
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

  // 服务端在任务改动目录后广播 fs changed：带上条目级 changes 就原地打补丁，
  // 只有拿不到 changes 时才退回整目录刷新。
  // 这取代了过去跨实例的 moveRefresh 补丁。
  const unsubscribeFsChanged = subscribeFsChanged((paths, changes) => {
    if (!paths.length && !changes.length) {
      return
    }
    const current = basePathNormalized.value
    const change = changes.find(item => normalizeListingPath(item.dir) === current)
    // 正在整目录刷新时不打补丁（列表可能是空的 / 旧的），让刷新自己收尾
    if (change && !isLoading.value) {
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
    // 目录预览 / 面包屑下拉共享同一份原始列表缓存，补丁要同步写回
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
    if (normalizeListingPath(path) === basePathNormalized.value && !forceRefresh) {
      return
    }
    basePath.value = path
    await handleRefresh(isUpdateHistory)
  }
  const { openFile } = useOpener(basePath)

  // 打开文件或文件夹
  const handleOpen = async ({ item, list = [], openWith }: { item: IEntry, list: IEntry[], openWith?: OpenWithEnum }) => {
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

  const { state: starList } = useRemoteSetting<string[]>({
    key: LsKeys.STARED_PATH,
    createDefaultValue: () => [],
    normalize: value => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [],
  })

  const isStared = computed(() => {
    return starList.value.includes(basePathNormalized.value)
  })
  const toggleStar = () => {
    starList.value = toggleArrayElement([...starList.value], basePathNormalized.value)
  }

  return {
    isLoading,
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
    toggleStar,
    isStared,
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
