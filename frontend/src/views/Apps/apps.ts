import type { IEntry } from '@/types/server.ts'
import { defineAsyncComponent } from '@vue/runtime-core'
import { LsKeys } from '@/enum'
import { useRemoteSetting } from '@/hooks/use-remote-setting'

export enum OpenWithEnum {
  Browser = 'Browser',
  Share = 'Share',
  TextEditor = 'TextEditor',
  VideoPlayer = 'VideoPlayer',
  ImageViewer = 'ImageViewer',
  HtmlViewer = 'HtmlViewer',
  FileViewer = 'FileViewer',
  MediaPlayer = 'MediaPlayer',
  EndlessGallery = 'EndlessGallery',
}

export enum InternalAppEnum {
  SpeedTest = 'SpeedTest',
  TextSync = 'TextSync',
  KeyboardShortcuts = 'KeyboardShortcuts',
  Properties = 'Properties',
  Settings = 'Settings',
}

export type AppName = OpenWithEnum | InternalAppEnum

export interface AppParams {
  absPath: string
  item: IEntry
  basePath: string
  list: IEntry[]
}

/** How an app's window opens. Omitted fields keep the shared app-window defaults. */
export interface AppChrome {
  /** Start maximised. Defaults to true. */
  maximized?: boolean
  width?: string
  height?: string
  /** Step each new window down and to the right instead of stacking on one spot. */
  cascade?: boolean
}

export interface AppListItem {
  name: string
  openWith: OpenWithEnum
  icon: string
  component: Component
  singleInstance?: boolean
  chrome?: AppChrome
}

export interface InternalAppListItem {
  name: string
  appName: InternalAppEnum
  icon: string
  component: Component
  singleInstance?: boolean
  chrome?: AppChrome
}

export const AppList: AppListItem[] = [
  {
    name: 'Endless Gallery',
    openWith: OpenWithEnum.EndlessGallery,
    icon: 'mdi mdi-image-multiple',
    component: defineAsyncComponent(() => import('./EndlessGallery/EndlessGallery.vue')),
    singleInstance: true,
  },
  {
    name: 'Text Editor',
    openWith: OpenWithEnum.TextEditor,
    icon: 'mdi mdi-text-box-edit',
    component: defineAsyncComponent(() => import('./TextEditor.vue')),
  },
  {
    name: 'Image Viewer',
    openWith: OpenWithEnum.ImageViewer,
    icon: 'mdi mdi-image',
    component: defineAsyncComponent(() => import('./ImageViewer.vue')),
  },
  {
    name: 'HTML Viewer',
    openWith: OpenWithEnum.HtmlViewer,
    icon: 'mdi mdi-language-html5',
    component: defineAsyncComponent(() => import('./HtmlViewer.vue')),
  },
  {
    name: 'Media Player',
    openWith: OpenWithEnum.MediaPlayer,
    icon: 'mdi mdi-play-circle',
    component: defineAsyncComponent(() => import('./MediaPlayer/MediaPlayer.vue')),
    singleInstance: true,
  },
  {
    name: 'Video Player',
    openWith: OpenWithEnum.VideoPlayer,
    icon: 'mdi mdi-movie',
    component: defineAsyncComponent(() => import('./VideoPlayer.vue')),
  },
  {
    name: 'File Viewer',
    openWith: OpenWithEnum.FileViewer,
    icon: 'mdi mdi-asterisk',
    component: defineAsyncComponent(() => import('./FileViewer.vue')),
  },
]

export const InternalAppList: InternalAppListItem[] = [
  {
    name: 'Text Sync',
    appName: InternalAppEnum.TextSync,
    icon: 'mdi mdi-clipboard-outline',
    component: defineAsyncComponent(() => import('./TextSync.vue')),
    singleInstance: true,
  },
  {
    name: 'Speed Test',
    appName: InternalAppEnum.SpeedTest,
    icon: 'mdi mdi-speedometer',
    component: defineAsyncComponent(() => import('./SpeedTest.vue')),
    singleInstance: true,
  },
  {
    name: 'Keyboard Shortcuts',
    appName: InternalAppEnum.KeyboardShortcuts,
    icon: 'mdi mdi-keyboard-outline',
    component: defineAsyncComponent(() => import('./KeyboardShortcuts.vue')),
    singleInstance: true,
  },
  {
    name: 'Properties',
    appName: InternalAppEnum.Properties,
    icon: 'mdi mdi-information-outline',
    component: defineAsyncComponent(() => import('./Properties.vue')),
    chrome: {
      maximized: false,
      width: 'min(460px, 92vw)',
      height: 'auto',
    },
  },
  {
    name: 'Settings',
    appName: InternalAppEnum.Settings,
    icon: 'mdi mdi-cog',
    component: defineAsyncComponent(() => import('./Settings/Settings.vue')),
    singleInstance: true,
    chrome: {
      maximized: false,
      width: 'min(680px, 94vw)',
      height: 'min(760px, 88vh)',
    },
  },
]

/** O(1) lookup by `openWith`; entries not in AppList are absent (same as former find). */
export const appListByOpenWith = AppList.reduce(
  (acc, app) => {
    acc[app.openWith] = app
    return acc
  },
  {} as Partial<Record<OpenWithEnum, AppListItem>>,
)

export const appMetaByName = [...AppList, ...InternalAppList].reduce(
  (acc, app) => {
    const appName = 'openWith' in app ? app.openWith : app.appName
    acc[appName] = app
    return acc
  },
  {} as Partial<Record<AppName, AppListItem | InternalAppListItem>>,
)

export const Apps = [...AppList, ...InternalAppList].reduce(
  (acc, app) => {
    const appName = 'openWith' in app ? app.openWith : app.appName
    acc[appName] = app.component
    return acc
  },
  {} as Record<AppName, Component>,
)

export function getFileExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot).toLowerCase() : ''
}

function normalizeDefaultAppMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value).reduce<Record<string, string>>((acc, [ext, app]) => {
    if (typeof app === 'string' && app.trim()) {
      acc[ext] = app
    }
    return acc
  }, {})
}

/** Persistent map of file extension → built-in app or plugin id, e.g. { ".mp3": "MediaPlayer" } */
export const { state: defaultAppMap } = useRemoteSetting<Record<string, string>>({
  key: LsKeys.DEFAULT_APP_MAP,
  createDefaultValue: () => ({}),
  normalize: normalizeDefaultAppMap,
})

export function isBuiltinApp(name: string): name is OpenWithEnum {
  return (Object.values(OpenWithEnum) as string[]).includes(name)
}

export function getDefaultApp(filename: string): string | null {
  const ext = getFileExt(filename)
  return ext ? (defaultAppMap.value[ext] ?? null) : null
}

export function setDefaultApp(ext: string, openWith: string | null): void {
  if (openWith === null) {
    delete defaultAppMap.value[ext]
  }
  else {
    defaultAppMap.value[ext] = openWith
  }
}
