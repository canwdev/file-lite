import type { AppParams } from './apps'
import { OpenWithEnum } from './apps'

interface AppsStore {
  isShowApp: boolean
  appName: OpenWithEnum
  appTitle: string
  appParams: null | AppParams
}

export const appsStoreState = reactive<AppsStore>({
  isShowApp: false,
  appName: OpenWithEnum.TextEditor,
  appTitle: '',
  appParams: null,
})
