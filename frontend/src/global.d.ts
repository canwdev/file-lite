import type { Message } from 'element-plus'
import type { SFCInstallWithContext } from 'element-plus/es/utils'

declare module 'axios' {
  interface AxiosRequestConfig {
    isAuth?: boolean
    isToast?: boolean
    isRawResponse?: boolean
  }
}

declare global {
  interface Window {
    $message: SFCInstallWithContext<Message>
    $dialog: SFCInstallWithContext<ElMessageBox>
    $logout: (clearToken?: boolean) => void
    __APP_READY__: boolean
    // $fsWebApi: typeof import('@/api/filesystem').fsWebApi
  }
}

declare module 'vue' {
  export interface GlobalComponents {
    MdiIcon: typeof import('@/components/MdiIcon.vue')['default']
  }
}
