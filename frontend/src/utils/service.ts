import axios from 'axios'
import {authToken} from '@/store'

const Service = (config: {
  baseURL: string
  withCredentials?: boolean
  timeout?: number
  headers?: any
  isAuth?: boolean
  isToast?: boolean
  isRawResponse?: boolean
}) => {
  const {
    baseURL,
    withCredentials = false,
    timeout,
    headers,
    isAuth = true,
    isToast = true,
    isRawResponse = false,
  } = config || {}

  // 创建 axios 实例
  const service = axios.create({
    baseURL,
    withCredentials, // send cookies when cross-domain requests
    timeout, // request timeout
    headers, // 请求头部
  })

  // 请求 拦截器
  service.interceptors.request.use(
    (config) => {
      // window.$loadingBar.start()
      if (isAuth) {
        config.headers.Authorization = authToken.value
      }

      return config
    },
    (error) => Promise.reject(error),
  )

  // 响应 拦截器
  service.interceptors.response.use(
    (response) => {
      if (isRawResponse) {
        return response
      }
      const {data} = response
      // window.$loadingBar.finish()
      return data
    },
    async (error) => {
      const message = error.message
      const {response} = error || {}

      if (response?.status == 401) {
        console.log('[401] Authorization token 失效')
        authToken.value = ''
      }

      // extract backend message
      const backendMessage = response?.data?.message
      console.log('[backendMessage]', backendMessage)
      if (isToast) {
        if (backendMessage) {
          window.$message.error(backendMessage)
        } else {
          window.$message.error(message)
        }
      }
      // window.$loadingBar.error()
      return Promise.reject(error)
    },
  )

  return service
}

export default Service
