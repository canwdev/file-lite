import { useStorage } from '@vueuse/core'
import Cookies from 'js-cookie'
import { LsKeys } from '@/enum'

export const AUTH_TOKEN_COOKIE_KEY = 'file_lite_auth_token'

const cookieOpts: Cookies.CookieAttributes = {
  path: '/',
  sameSite: 'strict',
}
const persistentCookieOpts: Cookies.CookieAttributes = {
  ...cookieOpts,
  expires: 365, // 1 year
}
export const rememberAuth = useStorage(LsKeys.REMEMBER_AUTH, true, localStorage, {
  listenToStorageChanges: true,
})

function readTokenFromCookie(): string {
  return Cookies.get(AUTH_TOKEN_COOKIE_KEY) ?? ''
}
function migrateLegacyLocalStorage(): void {
  if (typeof localStorage === 'undefined')
    return
  try {
    const legacy = localStorage.getItem(AUTH_TOKEN_COOKIE_KEY)
    if (legacy && !Cookies.get(AUTH_TOKEN_COOKIE_KEY)) {
      Cookies.set(AUTH_TOKEN_COOKIE_KEY, legacy, persistentCookieOpts)
      localStorage.removeItem(AUTH_TOKEN_COOKIE_KEY)
    }
  }
  catch {
    /* ignore private mode / quota */
  }
}
migrateLegacyLocalStorage()
export const authToken = ref(readTokenFromCookie())
watch(
  authToken,
  (v) => {
    if (v) {
      Cookies.remove(AUTH_TOKEN_COOKIE_KEY, cookieOpts)
      Cookies.set(AUTH_TOKEN_COOKIE_KEY, v, rememberAuth.value ? persistentCookieOpts : cookieOpts)
    }
    else {
      Cookies.remove(AUTH_TOKEN_COOKIE_KEY, cookieOpts)
    }
  },
  { flush: 'sync' },
)

const MB = 1024 * 1024

export const PREVIEW_SIZE_UNLIMITED = -1

export const previewSizeOptions = [
  { label: 'Disabled', value: 0 },
  { label: '≤ 3 MB', value: 3 * MB },
  { label: '≤ 6 MB', value: 6 * MB },
  { label: '≤ 20 MB', value: 20 * MB },
  { label: 'Unlimited', value: PREVIEW_SIZE_UNLIMITED },
] as const

export function getPreviewSizeLabel(value: number): string {
  return previewSizeOptions.find(item => item.value === value)?.label ?? '≤ 3 MB'
}

export const settingsStore = useStorage(LsKeys.SETTINGS_STORE, {
  isNativePlayer: false,
  previewSize: 3 * MB,
  themeMode: 'auto' as 'auto' | 'light' | 'dark',
  colorTheme: '',
  appSingleInstance: true,
}, localStorage, {
  listenToStorageChanges: true,
  mergeDefaults: true,
})
