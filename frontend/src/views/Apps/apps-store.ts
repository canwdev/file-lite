import {OpenWithEnum} from './apps'

type AppsStore = {
  isShowApp: boolean
  absPath: string
  appName: OpenWithEnum
}

export const appsStoreState = reactive<AppsStore>({
  isShowApp: false,
  absPath: '',
  appName: OpenWithEnum.TextEditor,
})
