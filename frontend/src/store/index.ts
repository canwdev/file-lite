import { useStorage } from '@vueuse/core'
import Cookies from 'js-cookie'

export const AUTH_TOKEN_COOKIE_KEY = 'file_lite_auth_token'

const cookieOpts: Cookies.CookieAttributes = {
  path: '/',
  sameSite: 'strict',
  expires: 365, // 1 year
}

function readTokenFromCookie(): string {
  return Cookies.get(AUTH_TOKEN_COOKIE_KEY) ?? ''
}
function migrateLegacyLocalStorage(): void {
  if (typeof localStorage === 'undefined')
    return
  try {
    const legacy = localStorage.getItem(AUTH_TOKEN_COOKIE_KEY)
    if (legacy && !Cookies.get(AUTH_TOKEN_COOKIE_KEY)) {
      Cookies.set(AUTH_TOKEN_COOKIE_KEY, legacy, cookieOpts)
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
    if (v)
      Cookies.set(AUTH_TOKEN_COOKIE_KEY, v, cookieOpts)
    else
      Cookies.remove(AUTH_TOKEN_COOKIE_KEY, cookieOpts)
  },
  { flush: 'sync' },
)

export const isNativePlayer = useStorage('file_lite_use_native_player', false, localStorage, {
  listenToStorageChanges: true,
})
