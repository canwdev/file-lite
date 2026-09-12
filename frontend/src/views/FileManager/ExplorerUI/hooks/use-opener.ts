import type { MessageBoxData } from 'element-plus'
import type { IEntry } from '@/types/server'
import { fsWebApi } from '@/api/filesystem'
import { bytesToSize } from '@/utils'
import {
  regSupportedAudioFormat,
  regSupportedHtmlFormat,
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
  if (regSupportedHtmlFormat.test(item.name)) {
    return getOpenAppInfo(OpenWithEnum.HtmlViewer)
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

/**
 * 内置查看器的体积上限（字节）。未列出的 App（播放器 / File Viewer 等）不做限制。
 * 显式选择与自定义默认 App 都走同一套限制，不再有绕过路径。
 */
const FILE_SIZE_LIMITS: Partial<Record<OpenWithEnum, number>> = {
  [OpenWithEnum.TextEditor]: 1024 * 1024,
  [OpenWithEnum.HtmlViewer]: 100 * 1024 * 1024,
  [OpenWithEnum.EndlessGallery]: 100 * 1024 * 1024,
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
    try {
      const absPath = normalizePath(`${basePath.value}/${item.name}`)
      const openApp = (appName: OpenWithEnum) => {
        openAppWindow(appName, {
          absPath,
          item,
          basePath: basePath.value,
          list,
        })
      }
      const openInBrowser = () => {
        window.open(getStreamUrl(item), '_blank', 'noopener,noreferrer')
      }
      const openSpecialApp = async (appName: OpenWithEnum) => {
        if (appName === OpenWithEnum.Browser) {
          openInBrowser()
          return true
        }
        if (appName === OpenWithEnum.Share) {
          // 用户取消、或浏览器不支持 share 都算处理完毕，避免未捕获的 rejection
          try {
            await navigator.share({
              title: item.name,
              text: '',
              url: getStreamUrl(item),
            })
          }
          catch {
            // cancelled / unsupported
          }
          return true
        }
        return false
      }
      const confirmOpenLargeFile = async (appName: OpenWithEnum) => {
        const limit = FILE_SIZE_LIMITS[appName]
        if (limit == null) {
          return true
        }
        return await checkTooLargeFileDialog(item, limit)
      }

      const defaultOpenApp = openWith ? null : getDefaultOpenApp(item)
      const targetApp = openWith ?? defaultOpenApp!.openWith
      // 没有自定义默认、也不是匹配到的查看器：交给下面的「不支持类型」弹窗。
      // 必须排在 openSpecialApp 之前，否则 fallback 的 Browser 会被直接打开。
      const unsupportedFallback = !openWith && defaultOpenApp!.source === 'fallback'

      if (unsupportedFallback) {
        window.$dialog
          .confirm(
            `Continue to view? ${item.name}`,
            'Unsupported File Type',
            {
              type: 'info',
              confirmButtonText: 'Open in Browser',
              cancelButtonText: 'File Viewer',
              distinguishCancelAndClose: true,
            },
          )
          .then(() => {
            openInBrowser()
          })
          .catch((action: MessageBoxData) => {
            if (action === 'cancel') {
              openApp(OpenWithEnum.FileViewer)
            }
          })
        return
      }

      if (await openSpecialApp(targetApp)) {
        return
      }
      if (await confirmOpenLargeFile(targetApp)) {
        openApp(targetApp)
      }
    }
    catch (error) {
      console.error('[openFile] failed', error)
    }
  }

  return {
    openFile,
  }
}
