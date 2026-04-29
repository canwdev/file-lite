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

export const settingsStore = useStorage(LsKeys.SETTINGS_STORE, {
  isNativePlayer: false,
  enablePreview: true,
  themeMode: 'auto' as 'auto' | 'light' | 'dark',
  colorTheme: '',
  appSingleInstance: true,
}, localStorage, {
  listenToStorageChanges: true,
  mergeDefaults: true,
})
