import {defineAsyncComponent} from 'vue'

const TextEditor = defineAsyncComponent(() => import('./TextEditor.vue'))

export enum OpenWithEnum {
  Browser = 'Browser',
  Share = 'Share',
  TextEditor = 'TextEditor',
}

export const Apps = {
  TextEditor,
}
