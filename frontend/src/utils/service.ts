import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import axios from 'axios'
import { authToken } from '@/store'

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
        if (!authToken.value) {
          window.$logout?.(false)
          throw new Error('No auth token')
        }
        config.headers.Authorization = authToken.value
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
        console.log('[401] Authorization token 失效')
        window.$logout?.(true)
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
