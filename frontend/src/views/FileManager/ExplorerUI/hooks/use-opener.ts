import type { IEntry } from '@/types/server'
import { fsWebApi } from '@/api/filesystem'
import { bytesToSize } from '@/utils'
import {
  regSupportedAudioFormat,
  regSupportedImageFormat,
  regSupportedTextFormat,
  regSupportedVideoFormat,
} from '@/utils/is'
import { OpenWithEnum } from '@/views/Apps/apps'
import { appsStoreState } from '@/views/Apps/apps-store'
import { normalizePath } from '../../utils'

function checkTooLargeFileDialog(item: IEntry, bytes: number) {
  return new Promise<boolean>((resolve) => {
    if (item.size && item.size > bytes) {
      window.$dialog
        .confirm(
          `File ${item.name} (${bytesToSize(item.size)}) is larger than ${bytesToSize(bytes)}, are you sure to open it?`,
          'File is too large',
          {
            type: 'warning',
          },
        )
        .then(() => {
          resolve(true)
        })
        .catch(() => {
          resolve(false)
        })
    }
    else {
      resolve(true)
    }
  })
}

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
      // 1MB
      if (await checkTooLargeFileDialog(item, 1024 * 1024)) {
        openApp(OpenWithEnum.TextEditor)
      }
      return
    }
    if (regSupportedImageFormat.test(item.name)) {
      // 50MB
      if (await checkTooLargeFileDialog(item, 1024 * 1024 * 100)) {
        openApp(OpenWithEnum.ImageViewer)
      }
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

    window.$dialog
      .confirm(
        `Continue to open in browser? ${item.name}`,
        'Unsupported File Type',
        {
          type: 'info',
        },
      )
      .then(() => {
        window.open(getStreamUrl(item))
      })
      .catch()
  }

  return {
    openFile,
  }
}
