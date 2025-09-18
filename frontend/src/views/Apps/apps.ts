import {defineAsyncComponent} from 'vue'

export enum OpenWithEnum {
  Browser = 'Browser',
  Share = 'Share',
  TextEditor = 'TextEditor',
  MediaPlayer = 'MediaPlayer',
  ImageViewer = 'ImageViewer',
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
    name: 'Media Player',
    openWith: OpenWithEnum.MediaPlayer,
    icon: 'mdi mdi-play',
    component: defineAsyncComponent(() => import('./MediaPlayer.vue')),
  },
]

export const Apps = AppList.reduce(
  (acc, app) => {
    acc[app.openWith] = app.component
    return acc
  },
  {} as Record<OpenWithEnum, Component>,
)
