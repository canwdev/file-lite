import type { ManagedWindow } from '@canwdev/vgo-ui'
import type { AppName, AppParams } from './apps'
import type { PluginInfo } from '@/api/plugins'
import type { IEntry } from '@/types/server'
import { createWindowManager } from '@canwdev/vgo-ui'
import { appMetaByName, InternalAppEnum } from './apps'

export interface AppWindowData {
  appName: AppName | null
  plugin: PluginInfo | null
  appParams: AppParams
}

export type AppWindowState = ManagedWindow<AppWindowData>

/** File-list element that had focus when this window was opened. */
const focusReturn = new Map<string, HTMLElement>()

function rememberExplorerFocus(id: string) {
  const previous = document.activeElement
  if (!(previous instanceof HTMLElement))
    return
  if (!previous.closest('.explorer-list-wrap'))
    return
  focusReturn.set(id, previous)
}

/** Refocus the file the app was showing, falling back to the element that opened it. */
function focusReturnedFile(win: AppWindowState, fallback: HTMLElement) {
  const name = win.data.appParams.item?.name
  const list = fallback.closest('.explorer-list-wrap')
  if (name && list) {
    const item = list.querySelector(`[data-name="${CSS.escape(name)}"]`)
    if (item instanceof HTMLElement) {
      if (!item.matches('button, a, input, textarea, select, [tabindex]'))
        item.tabIndex = -1
      item.focus({ preventScroll: true })
      return
    }
  }
  fallback.focus({ preventScroll: true })
}

export const appWindows = createWindowManager<AppWindowData>({
  onClose(win) {
    const back = focusReturn.get(win.id)
    focusReturn.delete(win.id)
    const othersOpen = appWindows.windows.some(item => item.id !== win.id && !item.isClosing)
    if (!othersOpen && back?.isConnected)
      focusReturnedFile(win, back)
  },
})

/** Title shown when the app has not set its own. */
export function defaultAppTitle(data: AppWindowData) {
  if (data.plugin)
    return data.plugin.name
  return (data.appName && appMetaByName[data.appName]?.name) || data.appParams.item.name
}

const emptyInternalEntry: IEntry = {
  name: '',
  path: '',
  ext: '',
  isDirectory: false,
  hidden: false,
  lastModified: 0,
  birthtime: 0,
  size: 0,
  error: null,
}

/**
 * The window an app can be reused into, if it declares itself single-instance.
 *
 * `singleInstance` lives with the app in `AppList` / `InternalAppList` (plugins carry it in
 * their manifest), so the app decides this, not a user preference.
 */
function getReusableAppWindow(appName: AppName): AppWindowState | undefined {
  if (!appMetaByName[appName]?.singleInstance) {
    return undefined
  }
  return appWindows.windows.find(w => w.data.appName === appName && !w.isClosing)
}

function getReusablePluginWindow(plugin: PluginInfo): AppWindowState | undefined {
  if (!plugin.singleInstance)
    return undefined
  return appWindows.windows.find(w => w.data.plugin?.id === plugin.id && !w.isClosing)
}

function reuseWindow(win: AppWindowState, data: AppWindowData, title: string) {
  rememberExplorerFocus(win.id)
  win.data = data
  win.title = title
  appWindows.activate(win.id)
}

function openWindow(data: AppWindowData, title: string) {
  const maximized = data.appName ? (appMetaByName[data.appName]?.chrome?.maximized ?? true) : true
  const win = appWindows.open(data, { title, maximized })
  rememberExplorerFocus(win.id)
}

/**
 * 打开新 App 窗口并设为当前活动窗口
 */
export function openAppWindow(appName: AppName, appParams: AppParams) {
  const data: AppWindowData = { appName, plugin: null, appParams }
  const reusableWin = getReusableAppWindow(appName)
  if (reusableWin) {
    reuseWindow(reusableWin, data, defaultAppTitle(data))
    return
  }
  openWindow(data, defaultAppTitle(data))
}

export function openPluginWindow(plugin: PluginInfo, appParams?: AppParams) {
  const params = appParams ?? {
    absPath: '',
    item: { ...emptyInternalEntry, name: plugin.name },
    basePath: '',
    list: [],
  }
  const data: AppWindowData = { appName: null, plugin, appParams: params }
  const reusableWin = getReusablePluginWindow(plugin)
  if (reusableWin) {
    reuseWindow(reusableWin, data, params.absPath ? params.item.name : plugin.name)
    return
  }
  openWindow(data, plugin.name)
}

/** 打开或关闭指定单例内部 App（F1 / `?` / 主菜单共用） */
function toggleInternalApp(appName: InternalAppEnum, entryName: string) {
  const existing = appWindows.windows.find(
    w => w.data.appName === appName && !w.isClosing,
  )
  if (existing) {
    appWindows.close(existing.id)
    return
  }
  openAppWindow(appName, {
    absPath: '',
    item: { ...emptyInternalEntry, name: entryName },
    basePath: '',
    list: [],
  })
}

/** 打开或关闭 Text Sync（F1） */
export function toggleTextSyncApp() {
  toggleInternalApp(InternalAppEnum.TextSync, 'TextSync')
}

/** 打开或关闭 Keyboard Shortcuts 指南（`?`） */
export function toggleKeyboardShortcutsApp() {
  toggleInternalApp(InternalAppEnum.KeyboardShortcuts, 'KeyboardShortcuts')
}
