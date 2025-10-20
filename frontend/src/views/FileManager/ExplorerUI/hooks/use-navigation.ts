import type { IEntry } from '@server/types/server'
import type { OpenWithEnum } from '@/views/Apps/apps'
import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { NavigationHistory } from '@/views/FileManager/utils/navigation-history.ts'
import { normalizePath, toggleArrayElement } from '../../utils'
import { useOpener } from './use-opener'

export function useNavigation({ getListFn }: { getListFn: () => Promise<IEntry[]> }) {
  const files = ref<IEntry[]>([])

  const basePath = useStorage(LsKeys.NAV_PATH, '', localStorage, {
    listenToStorageChanges: false,
  })
  const basePathNormalized = computed(() => {
    let path = normalizePath(basePath.value)
    if (!/\/$/.test(path)) {
      path += '/'
    }
    return path
  })
  const isLoading = ref(false)
  const navigationHistory = ref<NavigationHistory | null>(null)

  const handleRefresh = async (isUpdateHistory = true) => {
    try {
      basePath.value = basePathNormalized.value

      files.value = []
      isLoading.value = true
      if (!basePath.value) {
        basePath.value = '/'
      }
      files.value = (await getListFn()) as unknown as IEntry[]

      if (!navigationHistory.value) {
        navigationHistory.value = new NavigationHistory(basePath.value)
      }
      else if (isUpdateHistory) {
        navigationHistory.value.go(basePath.value)
      }
    }
    catch (e) {
      console.error(e)
      files.value = []
    }
    finally {
      isLoading.value = false
    }
  }

  /* 历史记录功能 START */
  const goBack = async () => {
    const { path } = navigationHistory.value?.back()
    if (!path) {
      return
    }
    await handleOpenPath(path, false)
  }
  const goForward = async () => {
    const { path } = navigationHistory.value?.forward()
    if (!path) {
      return
    }
    await handleOpenPath(path, false)
  }
  /* 历史记录功能 END */

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
  // 检测以/开头的路径为unix路径
  const isUnix = computed(() => {
    return /^\//.test(basePath.value)
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

  const handleOpenPath = async (path: string, isUpdateHistory: boolean) => {
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

  const filterText = ref('')
  const filteredFiles = computed(() => {
    const search = filterText.value.toLowerCase()
    return files.value.filter(item => item.name.toLowerCase().includes(search))
  })

  return {
    isLoading,
    filteredFiles,
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
