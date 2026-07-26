import { useStorage } from '@vueuse/core'
import Cookies from 'js-cookie'
import { setSharedWsToken } from '@/api/shared-ws'
import { LsKeys } from '@/enum'

export const AUTH_TOKEN_COOKIE_KEY = 'file_lite_auth_token'

const cookieOpts: Cookies.CookieAttributes = {
  path: '/',
  sameSite: 'strict',
  secure: typeof location !== 'undefined' && location.protocol === 'https:',
}

const persistentCookieOpts: Cookies.CookieAttributes = {
  ...cookieOpts,
  expires: 365,
}

export const rememberAuth = useStorage(LsKeys.REMEMBER_AUTH, true, localStorage, {
  listenToStorageChanges: true,
})

function readTokenFromCookie(): string {
  return Cookies.get(AUTH_TOKEN_COOKIE_KEY) ?? ''
}

function writeAuthCookie(token: string) {
  Cookies.remove(AUTH_TOKEN_COOKIE_KEY, cookieOpts)
  Cookies.set(AUTH_TOKEN_COOKIE_KEY, token, rememberAuth.value ? persistentCookieOpts : cookieOpts)
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
setSharedWsToken(authToken.value)

watch(
  authToken,
  (value) => {
    setSharedWsToken(value)
    if (value) {
      writeAuthCookie(value)
    }
    else {
      Cookies.remove(AUTH_TOKEN_COOKIE_KEY, cookieOpts)
    }
  },
  { flush: 'sync' },
)

watch(rememberAuth, () => {
  if (authToken.value) {
    writeAuthCookie(authToken.value)
  }
})
