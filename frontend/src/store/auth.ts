import { useStorage } from '@vueuse/core'
import Cookies from 'js-cookie'
import { LsKeys } from '@/enum'

/**
 * Readable session cookie, set and cleared by the backend next to the HttpOnly
 * auth cookie. It is not a credential: the frontend uses it as a synchronous
 * "logged in" hint and echoes it in the CSRF header.
 */
export const AUTH_SESSION_COOKIE_KEY = 'file_lite_session'

export const rememberAuth = useStorage(LsKeys.REMEMBER_AUTH, true, localStorage, {
  listenToStorageChanges: true,
})

/**
 * Mirror of the readable session cookie.
 *
 * The auth token itself is an HttpOnly cookie that JavaScript can never read.
 * This value answers "is there a session?", keys remote settings, and is what
 * `service` echoes for the backend's CSRF double-submit check.
 */
export const authSession = ref(readAuthSession())

export function readAuthSession(): string {
  return Cookies.get(AUTH_SESSION_COOKIE_KEY) ?? ''
}

export function setAuthSession(value: string): void {
  authSession.value = value
}

export function clearAuthSession(): void {
  authSession.value = ''
}
