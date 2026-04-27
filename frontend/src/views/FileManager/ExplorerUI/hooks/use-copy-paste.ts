import { fsWebApi } from '@/api/filesystem'
import { useSharedRef } from '@/hooks/use-shared-ref'
import explorerBus, { ExplorerEvents } from '../../utils/bus'

const explorerStore = useSharedRef<{
  cutPaths: string[]
  copyPaths: string[]
}>('file-lite:explorer-copy-paste', {
  cutPaths: [],
  copyPaths: [],
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

  const handleCut = () => {
    explorerStore.value.copyPaths = []
    explorerStore.value.cutPaths = [...selectedPaths.value]
  }

  const handleCopy = () => {
    explorerStore.value.cutPaths = []
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
    // console.log(paths)

    try {
      isLoading.value = true
      await fsWebApi.copyPaste({
        fromPaths: paths,
        toPath: basePath.value,
        isMove,
      })
      if (isMove) {
        explorerStore.value.cutPaths = []
        explorerBus.emit(ExplorerEvents.REFRESH)
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

  return {
    enablePaste,
    handleCut,
    handleCopy,
    handlePaste,
  }
}
