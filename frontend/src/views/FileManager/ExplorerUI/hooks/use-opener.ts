import type { ModalWindowButton } from '@canwdev/vgo-ui'
import type { PluginInfo } from '@/api/plugins'
import type { IEntry } from '@/types/server'
import { showModalWindow } from '@canwdev/vgo-ui'
import { listPlugins, pluginList } from '@/api/plugins'
import { serverCapabilities } from '@/store/capabilities'
import { bytesToSize } from '@/utils'
import { fs } from '@/utils/fs'
import {
  regSupportedAudioFormat,
  regSupportedHtmlFormat,
  regSupportedImageFormat,
  regSupportedTextFormat,
  regSupportedVideoFormat,
} from '@/utils/is'
import { appListByOpenWith, getDefaultApp, getFileExt, isBuiltinApp, OpenWithEnum } from '@/views/Apps/apps'
import { openAppWindow, openPluginWindow } from '@/views/Apps/apps-store'
import { matchesExtractExtension, startArchiveExtract } from '@/views/FileManager/ExplorerUI/archive-dialog.ts'
import { joinPath, normalizePath } from '../../utils'

interface OpenAppInfo {
  name: string
  icon: string
  openWith: string
  source: 'custom' | 'matched' | 'fallback'
  plugin?: PluginInfo
}

type OpenAppMeta = Omit<OpenAppInfo, 'source'>

/** 内置的「用其它方式打开」项；文案在调用时翻译，模块级常量会锁死在加载时的语言上。 */
function getSpecialOpenApp(openWith: OpenWithEnum): OpenAppMeta | undefined {
  switch (openWith) {
    case OpenWithEnum.Browser:
      return { name: $t('file_lite_i18n.browser'), icon: 'mdi mdi-open-in-new', openWith: OpenWithEnum.Browser }
    case OpenWithEnum.Share:
      return { name: $t('file_lite_i18n.share'), icon: 'mdi mdi-share-variant', openWith: OpenWithEnum.Share }
    default:
      return undefined
  }
}

function getOpenAppInfo(openWith: OpenWithEnum): OpenAppInfo {
  const app: OpenAppMeta = appListByOpenWith[openWith] ?? getSpecialOpenApp(openWith) ?? {
    name: openWith,
    icon: 'mdi mdi-open-in-app',
    openWith,
  }
  return { ...app, source: 'matched' }
}

export function matchOpenApp(item: IEntry): OpenAppInfo {
  if (regSupportedImageFormat.test(item.name)) {
    return { ...getOpenAppInfo(OpenWithEnum.EndlessGallery), source: 'matched' }
  }
  if (regSupportedHtmlFormat.test(item.name)) {
    return { ...getOpenAppInfo(OpenWithEnum.HtmlViewer), source: 'matched' }
  }
  if (regSupportedTextFormat.test(item.name)) {
    return { ...getOpenAppInfo(OpenWithEnum.TextEditor), source: 'matched' }
  }
  if (regSupportedAudioFormat.test(item.name)) {
    return { ...getOpenAppInfo(OpenWithEnum.MediaPlayer), source: 'matched' }
  }
  if (regSupportedVideoFormat.test(item.name)) {
    return { ...getOpenAppInfo(OpenWithEnum.VideoPlayer), source: 'matched' }
  }

  return { ...getOpenAppInfo(OpenWithEnum.Browser), source: 'fallback' }
}

function normExt(ext: string) {
  const value = ext.trim().toLowerCase()
  if (!value)
    return ''
  return value.startsWith('.') ? value : `.${value}`
}

function pluginOpenApp(plugin: PluginInfo, source: OpenAppInfo['source']): OpenAppInfo {
  return {
    name: plugin.name,
    icon: 'mdi mdi-puzzle-outline',
    openWith: plugin.id,
    source,
    plugin,
  }
}

/** 同一扩展名有多个插件时，取它在各自 openWith 里更靠前的那个。 */
function matchPluginOpenApp(item: IEntry): OpenAppInfo | null {
  const ext = getFileExt(item.name)
  if (!ext)
    return null
  const ranked = pluginList.value
    .map(plugin => ({
      plugin,
      index: plugin.openWith.findIndex(entry => normExt(entry) === ext),
    }))
    .filter(entry => entry.index >= 0)
    .sort((a, b) => a.index - b.index)
  const plugin = ranked[0]?.plugin
  return plugin ? pluginOpenApp(plugin, 'matched') : null
}

export function getDefaultOpenApp(item: IEntry): OpenAppInfo {
  const customDefault = getDefaultApp(item.name)
  if (customDefault && isBuiltinApp(customDefault)) {
    return { ...getOpenAppInfo(customDefault), source: 'custom' }
  }
  if (customDefault) {
    const plugin = pluginList.value.find(entry => entry.id === customDefault)
    if (plugin)
      return pluginOpenApp(plugin, 'custom')
    return {
      name: customDefault,
      icon: 'mdi mdi-puzzle-outline',
      openWith: customDefault,
      source: 'custom',
    }
  }
  const builtin = matchOpenApp(item)
  if (builtin.source !== 'fallback')
    return builtin
  return matchPluginOpenApp(item) ?? builtin
}

function checkTooLargeFileDialog(item: IEntry, bytes: number) {
  return new Promise<boolean>((resolve) => {
    if (item.size && item.size > bytes) {
      window.$dialog
        .confirm(
          $t('file_lite_i18n.file_0_1_is_larger_than_2_are_yo', [item.name, bytesToSize(item.size), bytesToSize(bytes)]),
          $t('file_lite_i18n.file_is_too_large'),
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
}

export function useOpener(basePath: { value: string }) {
  /**
   * 打开用的地址。
   *
   * 两个调用点（新标签打开、navigator.share）都在用户手势的同步路径上；
   * 取不到地址时直接放弃，而不是 `await` 掉手势。
   */
  const getStreamUrl = (item: IEntry) => {
    return fs.url(normalizePath(joinPath(basePath.value, item.name)))
  }

  const openFile = async (
    {
      item,
      openWith,
    }: {
      item: IEntry
      openWith?: string
    },
    list: IEntry[],
  ) => {
    try {
      const absPath = normalizePath(joinPath(basePath.value, item.name))
      const openApp = (appName: OpenWithEnum) => {
        openAppWindow(appName, {
          absPath,
          item,
          basePath: basePath.value,
          list,
        })
      }
      const openPlugin = async (pluginId: string) => {
        const plugins = await listPlugins().catch(() => [])
        const plugin = plugins.find(entry => entry.id === pluginId)
        if (!plugin)
          return false
        openPluginWindow(plugin, {
          absPath,
          item,
          basePath: basePath.value,
          list,
        })
        return true
      }
      const openInBrowser = () => {
        const url = getStreamUrl(item)
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
      }
      const openSpecialApp = async (appName: OpenWithEnum) => {
        if (appName === OpenWithEnum.Browser) {
          openInBrowser()
          return true
        }
        if (appName === OpenWithEnum.Share) {
          // 用户取消、或浏览器不支持 share 都算处理完毕，避免未捕获的 rejection
          try {
            const url = getStreamUrl(item)
            if (!url) {
              return true
            }
            await navigator.share({
              title: item.name,
              text: '',
              url,
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

      let defaultOpenApp = openWith ? null : getDefaultOpenApp(item)
      let targetApp = openWith ?? defaultOpenApp!.openWith
      if (!isBuiltinApp(targetApp)) {
        if (await openPlugin(targetApp))
          return
        if (openWith)
          return
        defaultOpenApp = matchOpenApp(item)
        targetApp = defaultOpenApp.openWith
      }
      // 没有自定义默认、也不是匹配到的查看器：交给下面的「不支持类型」弹窗。
      // 必须排在 openSpecialApp 之前，否则 fallback 的 Browser 会被直接打开。
      const unsupportedFallback = !openWith && defaultOpenApp!.source === 'fallback'

      if (unsupportedFallback) {
        const canExtract = serverCapabilities.value.archive
          && matchesExtractExtension(item.name, serverCapabilities.value.archiveExtractExtensions)
        type UnsupportedAction = 'viewer' | 'extract' | 'browser'
        const buttons: ModalWindowButton[] = [
          { label: $t('file_lite_i18n.file_viewer'), value: 'viewer' },
        ]
        if (canExtract) {
          buttons.push({ label: 'Extract...', value: 'extract' })
        }
        buttons.push({ label: $t('file_lite_i18n.open_in_browser'), variant: 'primary', value: 'browser' })
        const action = await showModalWindow<UnsupportedAction>({
          title: $t('file_lite_i18n.unsupported_file_type'),
          content: $t('file_lite_i18n.continue_to_view_0', [item.name]),
          buttons,
        })
        if (action === 'browser') {
          openInBrowser()
          return
        }
        if (action === 'viewer') {
          openApp(OpenWithEnum.FileViewer)
          return
        }
        if (action === 'extract') {
          try {
            await startArchiveExtract([absPath], [item.name], basePath.value)
          }
          catch (error: any) {
            if (error === 'cancel' || error === 'close')
              return
            window.$message?.error(error?.message || $t('file_lite_i18n.failed_to_start_the_task'))
          }
        }
        return
      }

      if (await openSpecialApp(targetApp as OpenWithEnum)) {
        return
      }
      if (await confirmOpenLargeFile(targetApp as OpenWithEnum)) {
        openApp(targetApp as OpenWithEnum)
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
