import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import axios from 'axios'
import Cookies from 'js-cookie'
import { AUTH_SESSION_COOKIE_KEY } from '@/store/auth'

const CSRF_HEADER = 'X-File-Lite-CSRF'
const SAFE_METHODS = new Set(['get', 'head', 'options'])

export interface ServiceRequestConfig extends AxiosRequestConfig {
  withCredentials?: boolean
  timeout?: number
  headers?: any
  isAuth?: boolean
  isToast?: boolean
  isRawResponse?: boolean
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
        const session = Cookies.get(AUTH_SESSION_COOKIE_KEY)
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

      if (response?.status === 401) {
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
