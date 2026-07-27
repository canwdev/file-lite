import { fsWebApi } from '@/api/filesystem'
import { useSharedRef } from '@/hooks/use-shared-ref'
import { normalizeListingPath, normalizePath } from '../../utils'

const explorerStore = useSharedRef<{
  cutPaths: string[]
  copyPaths: string[]
  cutBasePath: string
  /** 剪切粘贴完成后通知仍停留在源目录的实例刷新 */
  moveRefresh: { fromPath: string, token: number } | null
}>('file-lite:explorer-copy-paste', {
  cutPaths: [],
  copyPaths: [],
  cutBasePath: '',
  moveRefresh: null,
})

export function useCopyPaste({
  selectedPaths,
  basePath,
  isLoading,
  emit,
}: {
  selectedPaths: Ref<string[]>
  basePath: Ref<string>
  isLoading: Ref<boolean>
  emit: any
}) {
  const enablePaste = computed(() => {
    return explorerStore.value.cutPaths.length > 0 || explorerStore.value.copyPaths.length > 0
  })

  /** 当前目录下被剪切的文件名集合（用于半透明样式） */
  const currentCutNames = computed(() => {
    const names = new Set<string>()
    for (const p of explorerStore.value.cutPaths) {
      const normalized = normalizePath(p)
      const name = normalized.split('/').pop()
      if (name && normalizePath(`${basePath.value}/${name}`) === normalized)
        names.add(name)
    }
    return names
  })

  const handleCut = () => {
    explorerStore.value.copyPaths = []
    explorerStore.value.cutPaths = [...selectedPaths.value]
    explorerStore.value.cutBasePath = normalizeListingPath(basePath.value)
  }

  const handleCopy = () => {
    explorerStore.value.cutPaths = []
    explorerStore.value.cutBasePath = ''
    explorerStore.value.copyPaths = [...selectedPaths.value]
  }

  const handlePaste = async () => {
    let paths: string[] = []
    let isMove = false
    if (explorerStore.value.cutPaths.length) {
      paths = explorerStore.value.cutPaths
      isMove = true
    }
    else if (explorerStore.value.copyPaths.length) {
      paths = explorerStore.value.copyPaths
    }
    else {
      return
    }

    const sourceBasePath = explorerStore.value.cutBasePath

    try {
      isLoading.value = true
      await fsWebApi.copyPaste({
        fromPaths: paths,
        toPath: basePath.value,
        isMove,
      })
      if (isMove) {
        explorerStore.value.cutPaths = []
        explorerStore.value.cutBasePath = ''
        // 始终刷新目标目录（当前目录）
        emit('refresh')
        // 若源目录与目标不同，通知仍停留在源目录的实例刷新（含跨窗口）
        const destPath = normalizeListingPath(basePath.value)
        if (sourceBasePath && sourceBasePath !== destPath) {
          explorerStore.value.moveRefresh = {
            fromPath: sourceBasePath,
            token: Date.now(),
          }
        }
      }
      else {
        explorerStore.value.copyPaths = []
        emit('refresh')
      }
    }
    finally {
      isLoading.value = false
    }
  }

  // 剪切粘贴完成后：若当前仍在源文件夹则刷新
  watch(
    () => explorerStore.value.moveRefresh,
    (val) => {
      if (!val?.fromPath)
        return
      if (normalizeListingPath(basePath.value) === normalizeListingPath(val.fromPath))
        emit('refresh')
    },
  )

  return {
    enablePaste,
    handleCut,
    handleCopy,
    handlePaste,
    currentCutNames,
  }
}
