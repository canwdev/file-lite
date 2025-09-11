import {IEntry} from '@server/types/server'
import {fsWebApi} from '@/api/filesystem'
import {normalizePath} from '../../utils'
import {isSupportedMediaFormat, regSupportedTextFormat, shortcutFilenameReg} from '@/utils/is'

export const useOpener = (basePath, isLoading) => {
  const openFileFile = async (item: IEntry) => {
    await fsWebApi.getStream({path: normalizePath(basePath.value + '/' + item.name)})
  }
  const openFileNewTab = async (item: IEntry) => {
    try {
      isLoading.value = true
      const url = fsWebApi.getDownloadUrl([normalizePath(basePath.value + '/' + item.name)])
      window.open(url)
    } finally {
      isLoading.value = false
    }
  }

  const openFile = async (item: IEntry, list: IEntry[]) => {
    // if (isSupportedMediaFormat(item.name)) {
    //   systemStore.createTaskById('os.media-player', {item, list, basePath: basePath.value})
    //   return
    // }
    //
    // if (regSupportedTextFormat.test(item.name)) {
    //   systemStore.createTaskById('os.text-editor', {item, basePath: basePath.value})
    //   return
    // }
    await openFileNewTab(item)
  }

  return {
    openFile,
  }
}
