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
  let refreshController: AbortController | null = null
  let refreshSeq = 0

  const handleRefresh = async (isUpdateHistory = true) => {
    refreshController?.abort()
    const controller = new AbortController()
    refreshController = controller
    const currentSeq = ++refreshSeq

    try {
      basePath.value = basePathNormalized.value

      isLoading.value = true
      files.value = []
      if (!basePath.value) {
        basePath.value = '/'
      }
      const list = (await getListFn({ signal: controller.signal })) as unknown as IEntry[]
      if (controller.signal.aborted || currentSeq !== refreshSeq) {
        return
      }

      files.value = list
      // 当前目录列表是最新鲜的，写入目录子项缓存供预览/下拉复用
      seedFolderListing(basePath.value, list)

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
      files.value = []
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

function isAbortError(error: unknown) {
  return (
    typeof error === 'object'
    && error !== null
    && ('code' in error || 'name' in error)
    && ((error as { code?: string }).code === 'ERR_CANCELED' || (error as { name?: string }).name === 'CanceledError')
  )
}
