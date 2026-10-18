import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import axios from 'axios'
import { readAuthSession } from '@/store/auth'
import { refreshSessionOnce } from '@/utils/session-refresh'

const CSRF_HEADER = 'X-File-Lite-CSRF'
const SAFE_METHODS = new Set(['get', 'head', 'options'])

export interface ServiceRequestConfig extends AxiosRequestConfig {
  withCredentials?: boolean
  timeout?: number
  headers?: any
  isAuth?: boolean
  isToast?: boolean
  isRawResponse?: boolean
  /** Internal: this request has already been replayed after a renewal. */
  __authRetried?: boolean
  /** Internal: a session probe that must not trigger the global sign-out. */
  isSessionProbe?: boolean
}

function createService(): AxiosInstance {
  const service = axios.create()

  // 请求 拦截器
  service.interceptors.request.use(
    (config) => {
      const requestConfig = config as ServiceRequestConfig
      const isAuth = requestConfig.isAuth ?? true

      // window.$loadingBar.start()
      if (isAuth) {
        // The HttpOnly auth cookie rides along on same-origin requests by
        // itself. Only the readable session value must be echoed back for the
        // double-submit check, and only on methods the backend treats as unsafe.
        const method = (config.method ?? 'get').toLowerCase()
        const session = readAuthSession()
        if (session && !SAFE_METHODS.has(method)) {
          config.headers[CSRF_HEADER] = session
        }
      }

      return config
    },
    error => Promise.reject(error),
  )

  // 响应 拦截器
  service.interceptors.response.use(
    (response) => {
      const requestConfig = response.config as ServiceRequestConfig
      const isRawResponse = requestConfig.isRawResponse ?? false
      if (isRawResponse) {
        return response
      }
      const { data } = response
      // window.$loadingBar.finish()
      return data
    },
    async (error) => {
      if (axios.isCancel(error) || error.code === 'ERR_CANCELED') {
        return Promise.reject(error)
      }

      const message = error.message
      const { response } = error || {}
      const requestConfig = response?.config as ServiceRequestConfig | undefined
      const isToast = requestConfig?.isToast ?? true
      const isSessionProbe = requestConfig?.isSessionProbe === true

      if (response?.status === 401) {
        if (requestConfig && requestConfig.isAuth !== false && !requestConfig.__authRetried) {
          requestConfig.__authRetried = true
          const refreshed = await refreshSessionOnce()
          if (refreshed === 'renewed') {
            // The access cookie was replaced; the browser sends the new one on
            // the retry. A 401 comes from the auth middleware before the
            // handler runs, so replaying even an unsafe request is safe.
            return service.request(requestConfig)
          }
          if (refreshed === 'unavailable') {
            // No verdict (network / 5xx): keep the session, do not sign out.
            if (isToast) {
              window.$message?.error(response?.data?.message ?? message)
            }
            return Promise.reject(error)
          }
        }
        // A ticket-ignore probe lets its caller fall back to redeeming the
        // ticket; it must not clear the local state.
        if (isSessionProbe) {
          return Promise.reject(error)
        }
        console.log('[401] session expired')
        // The server session is already gone; just drop local state.
        window.$logout?.(false)
      }

      // extract backend message
      const backendMessage = response?.data?.message
      console.log('[backendMessage]', backendMessage)
      if (isToast) {
        if (backendMessage) {
          window.$message?.error(backendMessage)
        }
        else {
          window.$message?.error(message)
        }
      }
      // window.$loadingBar.error()
      return Promise.reject(error)
    },
  )

  return service
}

const service = createService()

export default service
