import {IEntry} from '@server/types/server'
import {fsWebApi} from '@/api/filesystem'
import {normalizePath} from '../../utils'
import {regSupportedTextFormat} from '@/utils/is'
import {appsStoreState} from '@/views/Apps/apps-store'

export const useOpener = (basePath: Ref<string>, isLoading: Ref<boolean>) => {
  const openFileNewTab = async (item: IEntry) => {
    try {
      isLoading.value = true
      const url = fsWebApi.getStreamUrl(normalizePath(basePath.value + '/' + item.name))
      window.open(url)
    } finally {
      isLoading.value = false
    }
  }

  const openFile = async (item: IEntry, list: IEntry[]) => {
    if (regSupportedTextFormat.test(item.name)) {
      appsStoreState.absPath = normalizePath(basePath.value + '/' + item.name)
      appsStoreState.isShowApp = true
      return
    }
    await openFileNewTab(item)
  }

  return {
    openFile,
  }
}
