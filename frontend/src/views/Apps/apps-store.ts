import type { AppParams, OpenWithEnum } from './apps'

/** ViewPortWindow 实例暴露（用于置顶、聚焦） */
export type AppWindowViewRef = {
  setActive: () => void
  focus: () => void
} | null

export interface AppWindowState {
  id: string
  appName: OpenWithEnum
  appTitle: string
  appParams: AppParams
  minimized: boolean
  maximized: boolean
  isClosing: boolean
  windowRef: AppWindowViewRef
}

function newWindowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export const appsStoreState = reactive({
  windows: [] as AppWindowState[],
  activeId: '',
})

function createWindowState(appName: OpenWithEnum, appParams: AppParams): AppWindowState {
  return {
    id: newWindowId(),
    appName,
    appTitle: '',
    appParams,
    minimized: false,
    maximized: false,
    isClosing: false,
    windowRef: null,
  }
}

/**
 * 打开新 App 窗口并设为当前活动窗口（参考 canos createTask / activeId）
 */
export function openAppWindow(appName: OpenWithEnum, appParams: AppParams) {
  const win = createWindowState(appName, appParams)
  appsStoreState.windows.push(win)
  appsStoreState.activeId = win.id
}

/**
 * 激活窗口；fromDock 为 true 时行为对齐任务栏：再次点击同一项则切换最小化
 */
export function setAppWindowActive(win: AppWindowState, fromDock = false) {
  if (fromDock) {
    if (appsStoreState.activeId === win.id) {
      win.minimized = !win.minimized
      return
    }
  }

  if (appsStoreState.activeId === win.id) {
    win.minimized = false
    return
  }

  appsStoreState.activeId = win.id
  win.minimized = false
  win.windowRef?.setActive()
  setTimeout(() => {
    win.windowRef?.focus()
  }, 0)
}

/**
 * 关闭窗口：先 isClosing 再移除，便于过渡（参考 canos closeTask）
 */
export function closeAppWindow(id: string) {
  const idx = appsStoreState.windows.findIndex(w => w.id === id)
  if (idx === -1) {
    return
  }

  const win = appsStoreState.windows[idx]
  const wasActive = appsStoreState.activeId === id
  win.isClosing = true

  setTimeout(() => {
    const i = appsStoreState.windows.findIndex(w => w.id === id)
    if (i === -1) {
      return
    }
    appsStoreState.windows.splice(i, 1)

    if (!wasActive) {
      return
    }

    let lastIdx = i - 1
    if (!appsStoreState.windows[lastIdx]) {
      lastIdx = appsStoreState.windows.length - 1
      if (!appsStoreState.windows[lastIdx]) {
        lastIdx = -1
      }
    }

    if (lastIdx > -1) {
      const last = appsStoreState.windows[lastIdx]
      appsStoreState.activeId = last.id
      if (!last.minimized) {
        last.windowRef?.setActive()
        setTimeout(() => last.windowRef?.focus(), 0)
      }
    }
    else {
      appsStoreState.activeId = ''
    }
  }, 300)
}

/**
 * 将 ref 列表同步到各窗口（参考 DesktopWindowManager 中对 windowRef 的赋值）
 */
export function syncAppWindowRefs(refs: unknown[]) {
  appsStoreState.windows.forEach((w, i) => {
    w.windowRef = (refs[i] as AppWindowViewRef) ?? null
  })
}
