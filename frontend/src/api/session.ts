import type { ServerCapabilities } from '@/store/capabilities'
import type { ServiceRequestConfig } from '@/utils/service'
import service from '@/utils/service'

/** `GET /api/session` 的响应：能力开关 + 允许的访问范围 + 会话期限。 */
export interface SessionInfo {
  capabilities?: Partial<ServerCapabilities>
  /**
   * 服务端配置的文件访问范围（`allowedRoots`），空数组表示不限制。
   *
   * 后端只在配置了它时才收窄，此时范围之外的请求一律 403。前端拿到这个值是为了
   * 把「为什么这里点不进去」讲清楚——一个没有说明的 403 只会让人以为坏了。
   */
  allowedRoots?: string[]
  /** 当前 access token 的绝对过期时间（RFC3339）。 */
  expiresAt?: string
  /** 剩余秒数，由服务端计算，避免客户端时钟偏差影响倒计时。 */
  expiresIn?: number
  /** `false` 表示固定期限的 ticket 会话，不能续签，到期自动登出。 */
  renewable?: boolean
}

/** The lifetime selected when minting a share ticket. */
export type LoginTicketTier = '15m' | '1h' | '8h' | '24h' | 'persistent'

/** 扫码登录票据：一个短命票据 + 每个本机地址一条可直接打开的登录 URL。 */
export interface LoginTicketInfo {
  value: string
  urls: string[]
  expiresAt: string
  tier: LoginTicketTier
}

/**
 * 读取当前会话：能力开关与访问范围。
 *
 * 未登录时服务端返回 401，因此这个请求本身就是登录态探测。
 */
export async function getSession(): Promise<SessionInfo> {
  return (await service.get(`/api/session`)) as unknown as SessionInfo
}

/**
 * Probe an existing session from the ticket-ignore path.
 *
 * Unlike `getSession` a 401 here must not trigger the global sign-out: the
 * caller decides whether to fall back to redeeming the ticket.
 */
export async function getSessionProbe(): Promise<SessionInfo> {
  const config: ServiceRequestConfig = {
    isSessionProbe: true,
    isToast: false,
  }
  return (await service.get(`/api/session`, config)) as unknown as SessionInfo
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
 * 固定期限的临时会话不能生成新票据，服务端会返回 403。
 */
export async function createLoginTicket(tier: LoginTicketTier = 'persistent'): Promise<LoginTicketInfo> {
  return (await service.post(`/api/session/tickets`, { tier })) as unknown as LoginTicketInfo
}
