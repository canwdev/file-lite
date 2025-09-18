import {AppParams, OpenWithEnum} from './apps'
import {IEntry} from '@server/types/server.ts'

type AppsStore = {
  isShowApp: boolean
  appName: OpenWithEnum
  appParams: null | AppParams
}

export const appsStoreState = reactive<AppsStore>({
  isShowApp: false,
  appName: OpenWithEnum.TextEditor,
  appParams: null,
})
