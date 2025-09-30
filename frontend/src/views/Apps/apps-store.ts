import type { AppParams } from './apps'
import { OpenWithEnum } from './apps'

interface AppsStore {
  isShowApp: boolean
  appName: OpenWithEnum
  appParams: null | AppParams
}

export const appsStoreState = reactive<AppsStore>({
  isShowApp: false,
  appName: OpenWithEnum.TextEditor,
  appParams: null,
})
