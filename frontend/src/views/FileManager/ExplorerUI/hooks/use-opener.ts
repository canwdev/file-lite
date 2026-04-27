import type { IEntry } from '@/types/server'
import { fsWebApi } from '@/api/filesystem'
import { bytesToSize } from '@/utils'
import {
  regSupportedAudioFormat,
  regSupportedImageFormat,
  regSupportedTextFormat,
  regSupportedVideoFormat,
} from '@/utils/is'
import { appListByOpenWith, getDefaultApp, OpenWithEnum } from '@/views/Apps/apps'
import { openAppWindow } from '@/views/Apps/apps-store'
import { normalizePath } from '../../utils'

interface OpenAppInfo {
  name: string
  icon: string
  openWith: OpenWithEnum
  source: 'custom' | 'matched' | 'fallback'
}

type OpenAppMeta = Omit<OpenAppInfo, 'source'>

const specialOpenApps: Partial<Record<OpenWithEnum, OpenAppMeta>> = {
  [OpenWithEnum.Browser]: {
    name: 'Browser',
    icon: 'mdi mdi-open-in-new',
    openWith: OpenWithEnum.Browser,
  },
  [OpenWithEnum.Share]: {
    name: 'Share',
    icon: 'mdi mdi-share-variant',
    openWith: OpenWithEnum.Share,
  },
}

function getOpenAppInfo(openWith: OpenWithEnum): OpenAppInfo {
  const app: OpenAppMeta = appListByOpenWith[openWith] ?? specialOpenApps[openWith] ?? {
    name: openWith,
    icon: 'mdi mdi-open-in-app',
    openWith,
  }
  return { ...app, source: 'matched' }
}

export function getDefaultOpenApp(item: IEntry): OpenAppInfo {
  const customDefault = getDefaultApp(item.name)
  if (customDefault) {
    return { ...getOpenAppInfo(customDefault), source: 'custom' }
  }

  if (regSupportedImageFormat.test(item.name)) {
    // return getOpenAppInfo(OpenWithEnum.ImageViewer)
    return getOpenAppInfo(OpenWithEnum.EndlessGallery)
  }
  if (regSupportedTextFormat.test(item.name)) {
    return getOpenAppInfo(OpenWithEnum.TextEditor)
  }
  if (regSupportedAudioFormat.test(item.name)) {
    return getOpenAppInfo(OpenWithEnum.MediaPlayer)
  }
  if (regSupportedVideoFormat.test(item.name)) {
    return getOpenAppInfo(OpenWithEnum.VideoPlayer)
  }

  return { ...getOpenAppInfo(OpenWithEnum.Browser), source: 'fallback' }
}

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

export function useOpener(basePath: { value: string }) {
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
      openAppWindow(appName, {
        absPath,
        item,
        basePath: basePath.value,
        list,
      })
    }
    const openSpecialApp = async (appName: OpenWithEnum) => {
      if (appName === OpenWithEnum.Browser) {
        window.open(getStreamUrl(item))
        return true
      }
      if (appName === OpenWithEnum.Share) {
        await navigator.share({
          title: item.name,
          text: '',
          url: getStreamUrl(item),
        })
        return true
      }
      return false
    }
    if (openWith) {
      if (await openSpecialApp(openWith)) {
        return
      }
      openApp(openWith)
      return
    }
    const defaultOpenApp = getDefaultOpenApp(item)
    if (defaultOpenApp.source === 'custom') {
      if (await openSpecialApp(defaultOpenApp.openWith)) {
        return
      }
      openApp(defaultOpenApp.openWith)
      return
    }
    if (defaultOpenApp.openWith === OpenWithEnum.ImageViewer) {
      // 50MB
      if (await checkTooLargeFileDialog(item, 1024 * 1024 * 100)) {
        openApp(OpenWithEnum.ImageViewer)
      }
      return
    }
    if (defaultOpenApp.openWith === OpenWithEnum.TextEditor) {
      // 1MB
      if (await checkTooLargeFileDialog(item, 1024 * 1024)) {
        openApp(OpenWithEnum.TextEditor)
      }
      return
    }
    if (defaultOpenApp.openWith !== OpenWithEnum.Browser) {
      openApp(defaultOpenApp.openWith)
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
