import type { IEntry } from '@/types/server'
import type { OpenWithEnum } from '@/views/Apps/apps'
import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { NavigationHistory } from '@/views/FileManager/utils/navigation-history.ts'
import { normalizeListingPath, normalizePath, toggleArrayElement } from '../../utils'
import { useOpener } from './use-opener'

export function useNavigation({ getListFn }: { getListFn: (options?: { signal?: AbortSignal }) => Promise<IEntry[]> }) {
  const files = ref<IEntry[]>([])

  const basePath = useStorage(LsKeys.NAV_PATH, '', localStorage, {
    listenToStorageChanges: false,
  })
  const basePathNormalized = computed(() => normalizeListingPath(basePath.value))
  const isLoading = ref(false)
  const navigationHistory = ref<NavigationHistory | null>(null)
  let refreshController: AbortController | null = null
  let refreshSeq = 0

  const handleRefresh = async (isUpdateHistory = true) => {
    refreshController?.abort()
    const controller = new AbortController()
    refreshController = controller
    const currentSeq = ++refreshSeq

    try {
      basePath.value = basePathNormalized.value

      files.value = []
      isLoading.value = true
      if (!basePath.value) {
        basePath.value = '/'
      }
      const list = (await getListFn({ signal: controller.signal })) as unknown as IEntry[]
      if (controller.signal.aborted || currentSeq !== refreshSeq) {
        return
      }

      files.value = list

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

  /* 历史记录功能 START */
  const goBack = async () => {
    const hist = navigationHistory.value
    if (!hist) {
      return
    }
    const item = hist.back()
    if (!item?.path) {
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

  // 检测以/开头的路径为unix路径
  const isUnix = computed(() => {
    return /^\//.test(basePath.value)
  })
  // 是否允许返回上一级
  const allowUp = computed(() => {
    const arr = basePath.value.split('/').filter(i => !!i)
    if (isUnix.value) {
      return arr.length > 0
    }
    else {
      return arr.length > 1
    }
  })
  const goUp = async () => {
    if (!allowUp.value) {
      return
    }
    const arr = basePath.value.split('/').filter(i => !!i)
    arr.pop()
    if (!arr.length && !isUnix.value) {
      await handleRefresh()
      return
    }
    let path = `${arr.join('/')}/`
    if (isUnix.value) {
      path = `/${path}`
    }
    await handleOpenPath(path, true)
  }
  const filterText = ref('')

  const handleOpenPath = async (path: string, isUpdateHistory: boolean = true) => {
    if (normalizeListingPath(path) === basePathNormalized.value) {
      return
    }
    basePath.value = path
    filterText.value = ''
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

  const starList = useStorage<string[]>(LsKeys.STARED_PATH, [])
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
    filterText,
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
