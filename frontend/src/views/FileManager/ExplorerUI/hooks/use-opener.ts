import {IEntry} from '@server/types/server'
import {fsWebApi} from '@/api/filesystem'
import {normalizePath} from '../../utils'
import {regSupportedAudioFormat, regSupportedTextFormat, regSupportedVideoFormat} from '@/utils/is'
import {appsStoreState} from '@/views/Apps/apps-store'
import {OpenWithEnum} from '@/views/Apps/apps'

export const useOpener = (basePath: Ref<string>, isLoading: Ref<boolean>) => {
  const getStreamUrl = (item: IEntry) => {
    return fsWebApi.getStreamUrl(normalizePath(basePath.value + '/' + item.name))
  }

  const openFile = async (
    {
      item,
      openWith,
    }: {
      item: IEntry
      openWith?: OpenWithEnum
    },
    list: IEntry[],
  ) => {
    const absPath = normalizePath(basePath.value + '/' + item.name)
    const openApp = (appName: OpenWithEnum) => {
      appsStoreState.absPath = absPath
      appsStoreState.isShowApp = true
      appsStoreState.appName = appName
    }
    if (openWith) {
      if (openWith === OpenWithEnum.Browser) {
        window.open(getStreamUrl(item))
        return
      }
      if (openWith === OpenWithEnum.Share) {
        await navigator.share({
          title: item.name,
          text: '',
          url: getStreamUrl(item),
        })
        return
      }
      openApp(openWith)
      return
    }
    if (regSupportedTextFormat.test(item.name)) {
      openApp(OpenWithEnum.TextEditor)
      return
    }
    if (regSupportedVideoFormat.test(item.name) || regSupportedAudioFormat.test(item.name)) {
      openApp(OpenWithEnum.MediaPlayer)
      return
    }
    window.open(getStreamUrl(item))
  }

  return {
    openFile,
  }
}
