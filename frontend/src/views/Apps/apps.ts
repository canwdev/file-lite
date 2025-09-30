import type { IEntry } from '@server/types/server.ts'
import { defineAsyncComponent } from 'vue'

export enum OpenWithEnum {
  Browser = 'Browser',
  Share = 'Share',
  TextEditor = 'TextEditor',
  VideoPlayer = 'VideoPlayer',
  ImageViewer = 'ImageViewer',
  MediaPlayer = 'MediaPlayer',
}

export interface AppParams {
  absPath: string
  item: IEntry
  basePath: string
  list: IEntry[]
}

export const AppList = [
  {
    name: 'Text Editor',
    openWith: OpenWithEnum.TextEditor,
    icon: 'mdi mdi-text-box-outline',
    component: defineAsyncComponent(() => import('./TextEditor.vue')),
  },
  {
    name: 'Image Viewer',
    openWith: OpenWithEnum.ImageViewer,
    icon: 'mdi mdi-image-outline',
    component: defineAsyncComponent(() => import('./ImageViewer.vue')),
  },
  {
    name: 'Video Player',
    openWith: OpenWithEnum.VideoPlayer,
    icon: 'mdi mdi-play',
    component: defineAsyncComponent(() => import('./VideoPlayer.vue')),
  },
  {
    name: 'Music Player',
    openWith: OpenWithEnum.MediaPlayer,
    icon: 'mdi mdi-music-circle',
    component: defineAsyncComponent(() => import('./MediaPlayer/MediaPlayer.vue')),
  },
]

export const Apps = AppList.reduce(
  (acc, app) => {
    acc[app.openWith] = app.component
    return acc
  },
  {} as Record<OpenWithEnum, Component>,
)
