import type { WalkDirection } from './tree-walk'
import type { AppParams } from '@/views/Apps/apps.ts'
import { normalizePath } from '@/views/FileManager/utils'
import { MAX_DIR_READS, walkToMediaFolder } from './tree-walk'

/**
 * 边缘卡片的「上/下一个文件夹」导航：扫描文件夹树，返回目标目录的 AppParams。
 * 找不到或被中断时返回 null（并给出必要提示）。
 */
export function useFolderNavigation(getAppParams: () => AppParams | undefined) {
  const isScanning = ref(false)
  let controller: AbortController | null = null

  function cancelScan(): void {
    controller?.abort()
    controller = null
    isScanning.value = false
  }

  onBeforeUnmount(cancelScan)

  async function navigateFolder(direction: WalkDirection): Promise<AppParams | null> {
    const basePath = getAppParams()?.basePath
    if (!basePath) {
      return null
    }

    controller?.abort()
    const currentController = new AbortController()
    controller = currentController
    isScanning.value = true

    try {
      const outcome = await walkToMediaFolder(basePath, direction, currentController.signal)

      if (outcome.status !== 'found') {
        if (outcome.status === 'limit') {
          window.$message.warning(`Stopped after scanning ${MAX_DIR_READS} folders`)
        }
        else if (outcome.status === 'boundary') {
          window.$message.info('No more folders with media')
        }
        return null
      }

      const { basePath: targetPath, entries, mediaEntries } = outcome
      const item = direction === 'next' ? mediaEntries[0] : mediaEntries[mediaEntries.length - 1]
      return {
        absPath: normalizePath(`${targetPath}/${item.name}`),
        item,
        basePath: targetPath,
        list: entries,
      }
    }
    finally {
      if (controller === currentController) {
        controller = null
        isScanning.value = false
      }
    }
  }

  return {
    isScanning,
    navigateFolder,
    cancelScan,
  }
}
