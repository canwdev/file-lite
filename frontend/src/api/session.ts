import type { ServerCapabilities } from '@/store/capabilities'
import type { ServiceRequestConfig } from '@/utils/service'
import service from '@/utils/service'

/** `GET /api/session` 的响应：能力开关 + 允许的访问范围。 */
export interface SessionInfo {
  capabilities?: Partial<ServerCapabilities>
  /**
   * 服务端配置的文件访问范围（`allowedRoots`），空数组表示不限制。
   *
   * 后端只在配置了它时才收窄，此时范围之外的请求一律 403。前端拿到这个值是为了
   * 把「为什么这里点不进去」讲清楚——一个没有说明的 403 只会让人以为坏了。
   */
  allowedRoots?: string[]
}

/** 扫码登录票据：一个短命票据 + 每个本机地址一条可直接打开的登录 URL。 */
export interface LoginTicketInfo {
  value: string
  urls: string[]
  expiresAt: string
}

/**
 * 读取当前会话：能力开关与访问范围。
 *
 * 未登录时服务端返回 401，因此这个请求本身就是登录态探测。
 */
export async function getSession(): Promise<SessionInfo> {
  return (await service.get(`/api/session`)) as unknown as SessionInfo
}

/** `remember` picks a persistent cookie over a session cookie. */
export function login(password: string, remember: boolean) {
  return service.post(`/api/session`, { password, remember }, { isAuth: false } satisfies ServiceRequestConfig)
}

export function consumeTicket(ticket: string, remember: boolean) {
  return service.post(`/api/session`, { ticket, remember }, { isAuth: false } satisfies ServiceRequestConfig)
}

export function logout() {
  // `isAuth` stays on so the interceptor echoes the session cookie as the CSRF
  // header. The backend still allows logout without a session cookie.
  return service.delete(`/api/session`, {
    isToast: false,
  } satisfies ServiceRequestConfig)
}

/**
 * 生成扫码登录票据。
 *
 * 服务端只保留一张票据，因此每次调用都会作废上一次返回的 URL；要在展示前重新生成。
 */
export async function createLoginTicket(): Promise<LoginTicketInfo> {
  return (await service.post(`/api/session/tickets`)) as unknown as LoginTicketInfo
}
