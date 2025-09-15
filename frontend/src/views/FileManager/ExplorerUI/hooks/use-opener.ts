import {IEntry} from '@server/types/server'
import {fsWebApi} from '@/api/filesystem'
import {normalizePath} from '../../utils'

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
    await openFileNewTab(item)
  }

  return {
    openFile,
  }
}
