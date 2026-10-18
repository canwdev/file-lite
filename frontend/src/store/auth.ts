import { useStorage } from '@vueuse/core'
import Cookies from 'js-cookie'
import { LsKeys } from '@/enum'

/**
 * Readable session cookie, set and cleared by the backend next to the HttpOnly
 * auth cookie. It is not a credential: the frontend uses it as a synchronous
 * "logged in" hint and echoes it in the CSRF header.
 *
 * The name is scoped to the scheme (`_https` / `_http`). A Secure cookie cannot
 * be overwritten from an HTTP origin, so one shared name would leave a browser
 * that once used HTTPS unable to sign in over HTTP: its stale Secure session
 * cookie is neither sent nor replaceable.
 */
const AUTH_SESSION_COOKIE_HTTPS = 'file_lite_session_https'
const AUTH_SESSION_COOKIE_HTTP = 'file_lite_session_http'

export const rememberAuth = useStorage(LsKeys.REMEMBER_AUTH, false, localStorage, {
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

/** False for a fixed-lifetime ticket session: no heartbeat, log out at expiry. */
export const authSessionRenewable = ref(true)
/** Absolute expiry of a fixed session (ms since epoch); 0 when not scheduled. */
export const authSessionExpiresAt = ref(0)
/** Countdown shown by the temporary-session badge. */
export const authSessionRemainingSeconds = ref(0)

export function readAuthSession(): string {
  // Prefer the cookie for the page's own scheme. The fallback keeps a session
  // readable when the server and the browser disagree (a TLS-terminating
  // proxy makes the backend see HTTP while the page is HTTPS).
  const primary = location.protocol === 'https:' ? AUTH_SESSION_COOKIE_HTTPS : AUTH_SESSION_COOKIE_HTTP
  const secondary = location.protocol === 'https:' ? AUTH_SESSION_COOKIE_HTTP : AUTH_SESSION_COOKIE_HTTPS
  return Cookies.get(primary) ?? Cookies.get(secondary) ?? ''
}

export function setAuthSession(value: string): void {
  authSession.value = value
}

export function setAuthSessionPolicy(renewable: boolean, expiresIn: number): void {
  authSessionRenewable.value = renewable
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? Math.floor(expiresIn) : 0
  authSessionRemainingSeconds.value = seconds
  authSessionExpiresAt.value = seconds > 0 ? Date.now() + seconds * 1000 : 0
}

export function clearAuthSession(): void {
  authSession.value = ''
  authSessionRenewable.value = true
  authSessionExpiresAt.value = 0
  authSessionRemainingSeconds.value = 0
}
