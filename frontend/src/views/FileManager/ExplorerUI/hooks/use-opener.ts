import type { IEntry } from '@server/types/server'
import { fsWebApi } from '@/api/filesystem'
import {
  regSupportedAudioFormat,
  regSupportedImageFormat,
  regSupportedTextFormat,
  regSupportedVideoFormat,
} from '@/utils/is'
import { OpenWithEnum } from '@/views/Apps/apps'
import { appsStoreState } from '@/views/Apps/apps-store'
import { normalizePath } from '../../utils'

export function useOpener(basePath: Ref<string>) {
  const getStreamUrl = (item: IEntry) => {
    return fsWebApi.getStreamUrl(normalizePath(`${basePath.value}/${item.name}`))
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
    const absPath = normalizePath(`${basePath.value}/${item.name}`)
    const openApp = (appName: OpenWithEnum) => {
      appsStoreState.appParams = {
        absPath,
        item,
        basePath: basePath.value,
        list,
      }
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
    if (regSupportedImageFormat.test(item.name)) {
      openApp(OpenWithEnum.ImageViewer)
      return
    }
    if (regSupportedAudioFormat.test(item.name)) {
      openApp(OpenWithEnum.MediaPlayer)
      return
    }
    if (regSupportedVideoFormat.test(item.name)) {
      openApp(OpenWithEnum.VideoPlayer)
      return
    }
    window.open(getStreamUrl(item))
  }

  return {
    openFile,
  }
}
