import type { ServerCapabilities } from '@/store/capabilities'
import type { ServiceRequestConfig } from '@/utils/service'
import service from '@/utils/service'

const baseURL = `/api/files`

/** 登录态探测的响应，同时携带后端能力开关与允许范围。 */
export interface IAuthInfo {
  capabilities?: Partial<ServerCapabilities>
  /**
   * 服务端配置的文件访问范围（`allowedRoots`），空数组表示不限制。
   *
   * 后端只在配置了它时才收窄，此时范围之外的请求一律 403。前端拿到这个值是为了
   * 把「为什么这里点不进去」讲清楚——一个没有说明的 403 只会让人以为坏了。
   */
  allowedRoots?: string[]
}

/**
 * Auth endpoints live outside the file API contract: they hand out and clear
 * the session cookies, and no token crosses the response body any more.
 */
export async function getAuthInfo(): Promise<IAuthInfo> {
  return (await service.get(`${baseURL}/auth`)) as unknown as IAuthInfo
}

/** `remember` picks a persistent cookie over a session cookie. */
export function login(password: string, remember: boolean) {
  return service.post(`${baseURL}/auth`, { password, remember }, { isAuth: false } satisfies ServiceRequestConfig)
}

export function consumeTicket(ticket: string, remember: boolean) {
  return service.post(`${baseURL}/auth`, { ticket, remember }, { isAuth: false } satisfies ServiceRequestConfig)
}

export function logout() {
  return service.post(`${baseURL}/auth/logout`, undefined, {
    isAuth: false,
    isToast: false,
  } satisfies ServiceRequestConfig)
}
