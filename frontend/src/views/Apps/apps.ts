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
}

export type AppName = OpenWithEnum | InternalAppEnum

export interface AppParams {
  absPath: string
  item: IEntry
  basePath: string
  list: IEntry[]
}

export interface AppListItem {
  name: string
  openWith: OpenWithEnum
  icon: string
  component: Component
  singleInstance?: boolean
}

export interface InternalAppListItem {
  name: string
  appName: InternalAppEnum
  icon: string
  component: Component
  singleInstance?: boolean
}

export const AppList: AppListItem[] = [
  {
    name: 'Endless Gallery',
    openWith: OpenWithEnum.EndlessGallery,
    icon: 'mdi mdi-view-carousel-outline',
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
    singleInstance: true,
  },
  {
    name: 'HTML Viewer',
    openWith: OpenWithEnum.HtmlViewer,
    icon: 'mdi mdi-language-html5',
    component: defineAsyncComponent(() => import('./HtmlViewer.vue')),
    singleInstance: true,
  },
  {
    name: 'Media Player',
    openWith: OpenWithEnum.MediaPlayer,
    icon: 'mdi mdi-music-circle',
    component: defineAsyncComponent(() => import('./MediaPlayer/MediaPlayer.vue')),
    singleInstance: true,
  },
  {
    name: 'Video Player',
    openWith: OpenWithEnum.VideoPlayer,
    icon: 'mdi mdi-play-circle',
    component: defineAsyncComponent(() => import('./VideoPlayer.vue')),
    singleInstance: true,
  },
  {
    name: 'File Viewer',
    openWith: OpenWithEnum.FileViewer,
    icon: 'mdi mdi-file-document-outline',
    component: defineAsyncComponent(() => import('./FileViewer.vue')),
    singleInstance: true,
  },
]

export const InternalAppList: InternalAppListItem[] = [
  {
    name: 'Text Sync',
    appName: InternalAppEnum.TextSync,
    icon: 'mdi mdi-clipboard',
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

function normalizeDefaultAppMap(value: unknown): Record<string, OpenWithEnum> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value).reduce<Record<string, OpenWithEnum>>((acc, [ext, app]) => {
    if (Object.values(OpenWithEnum).includes(app as OpenWithEnum)) {
      acc[ext] = app as OpenWithEnum
    }
    return acc
  }, {})
}

/** Persistent map of file extension → preferred OpenWithEnum, e.g. { ".mp3": "MediaPlayer" } */
export const { state: defaultAppMap } = useRemoteSetting<Record<string, OpenWithEnum>>({
  key: LsKeys.DEFAULT_APP_MAP,
  createDefaultValue: () => ({}),
  normalize: normalizeDefaultAppMap,
})

export function getDefaultApp(filename: string): OpenWithEnum | null {
  const ext = getFileExt(filename)
  return ext ? (defaultAppMap.value[ext] ?? null) : null
}

export function setDefaultApp(ext: string, openWith: OpenWithEnum | null): void {
  if (openWith === null) {
    delete defaultAppMap.value[ext]
  }
  else {
    defaultAppMap.value[ext] = openWith
  }
}
