import type { ManagedWindow } from '@canwdev/vgo-ui'
import type { AppName, AppParams } from './apps'
import type { AppTarget } from './registry'
import type { PluginInfo } from '@/api/plugins'
import type { IEntry } from '@/types/server'
import { createWindowManager } from '@canwdev/vgo-ui'
import { InternalAppEnum } from './apps'
import {
  builtinTarget,
  pluginTarget,
  targetChrome,
  targetId,
  targetName,
  targetSingleInstance,
} from './registry'

export interface AppWindowData {
  /** The app or plugin that owns the window. */
  target: AppTarget
  /** Launch state in the window manager's own shape; `app-launch.ts` maps it to the SDK's. */
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
  return targetName(data.target) || data.appParams.item.name
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
 * The window a target can be reused into, if it declares itself single-instance.
 *
 * `singleInstance` lives with the app in `AppList` / `InternalAppList` and with
 * the plugin in its manifest, so the target decides this, not a preference.
 */
function getReusableWindow(target: AppTarget): AppWindowState | undefined {
  if (!targetSingleInstance(target)) {
    return undefined
  }
  return appWindows.windows.find(w => targetId(w.data.target) === targetId(target) && !w.isClosing)
}

function reuseWindow(win: AppWindowState, data: AppWindowData, title: string) {
  rememberExplorerFocus(win.id)
  win.data = data
  win.title = title
  appWindows.activate(win.id)
}

/** Phones and narrow windows get a full-screen app window; anything wider stays floating. */
const AUTO_MAXIMIZE_MAX_WIDTH = 800

function openWindow(data: AppWindowData, title: string) {
  // Narrow screens get a full-screen window; wider ones keep the floating,
  // draggable window with its declared size.
  const maximized = targetChrome(data.target)?.maximized
    ?? window.innerWidth <= AUTO_MAXIMIZE_MAX_WIDTH
  const win = appWindows.open(data, { title, maximized })
  rememberExplorerFocus(win.id)
}

/** Open (or reuse) a window for a built-in app or a plugin. */
export function openTarget(target: AppTarget, appParams: AppParams) {
  const data: AppWindowData = { target, appParams }
  const reusableWin = getReusableWindow(target)
  if (reusableWin) {
    reuseWindow(reusableWin, data, target.kind === 'plugin'
      ? (appParams.absPath ? appParams.item.name : targetName(target))
      : defaultAppTitle(data))
    return
  }
  openWindow(data, defaultAppTitle(data))
}

/**
 * 打开新 App 窗口并设为当前活动窗口
 */
export function openAppWindow(appName: AppName, appParams: AppParams) {
  openTarget(builtinTarget(appName), appParams)
}

export function openPluginWindow(plugin: PluginInfo, appParams?: AppParams) {
  const params = appParams ?? {
    absPath: '',
    item: { ...emptyInternalEntry, name: plugin.name },
    basePath: '',
    list: [],
  }
  openTarget(pluginTarget(plugin), params)
}

/** 打开或关闭指定单例内部 App（F1 / `?` / 主菜单共用） */
function toggleInternalApp(appName: InternalAppEnum, entryName: string) {
  const existing = appWindows.windows.find(
    w => targetId(w.data.target) === appName && !w.isClosing,
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

/** Open or close Settings (Ctrl+,). */
export function toggleSettingsApp() {
  toggleInternalApp(InternalAppEnum.Settings, 'Settings')
}
