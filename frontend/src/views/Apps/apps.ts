import type { IEntry } from '@/types/server.ts'
import { defineAsyncComponent } from '@vue/runtime-core'
import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'

export enum OpenWithEnum {
  Browser = 'Browser',
  Share = 'Share',
  TextEditor = 'TextEditor',
  VideoPlayer = 'VideoPlayer',
  ImageViewer = 'ImageViewer',
  MediaPlayer = 'MediaPlayer',
  EndlessGallery = 'EndlessGallery',
}

export interface AppParams {
  absPath: string
  item: IEntry
  basePath: string
  list: IEntry[]
}

export const AppList = [
  {
    name: 'Endless Gallery',
    openWith: OpenWithEnum.EndlessGallery,
    icon: 'mdi mdi-view-carousel-outline',
    component: defineAsyncComponent(() => import('./EndlessGallery/EndlessGallery.vue')),
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
    name: 'Media Player',
    openWith: OpenWithEnum.MediaPlayer,
    icon: 'mdi mdi-music-circle',
    component: defineAsyncComponent(() => import('./MediaPlayer/MediaPlayer.vue')),
  },
  {
    name: 'Video Player',
    openWith: OpenWithEnum.VideoPlayer,
    icon: 'mdi mdi-play-circle',
    component: defineAsyncComponent(() => import('./VideoPlayer.vue')),
  },
]

export type AppListItem = (typeof AppList)[number]

/** O(1) lookup by `openWith`; entries not in AppList are absent (same as former find). */
export const appListByOpenWith = AppList.reduce(
  (acc, app) => {
    acc[app.openWith] = app
    return acc
  },
  {} as Partial<Record<OpenWithEnum, AppListItem>>,
)

export const Apps = AppList.reduce(
  (acc, app) => {
    acc[app.openWith] = app.component
    return acc
  },
  {} as Record<OpenWithEnum, Component>,
)

export function getFileExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot).toLowerCase() : ''
}

/** Persistent map of file extension → preferred OpenWithEnum, e.g. { ".mp3": "MediaPlayer" } */
export const defaultAppMap = useStorage<Record<string, OpenWithEnum>>(
  LsKeys.DEFAULT_APP_MAP,
  {},
  localStorage,
)

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
