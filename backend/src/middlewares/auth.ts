import type { NextFunction, Request, Response } from 'express'
import { internalConfig, isExplicitDevMode } from '@/config/config.ts'
import { IPRateLimiter } from './auth-limiter'

const AUTH_TOKEN_COOKIE_KEY = 'file_lite_auth_token'
const CSRF_HEADER_KEY = 'x-file-lite-csrf'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ⭐️ 在应用启动时创建 IPRateLimiter 的单例
// 这确保了所有请求共享同一个状态跟踪器
const authLimiter = new IPRateLimiter({
  maxAttempts: 5, // 最大失败次数
  banDurationMs: 15 * 60 * 1000, // 封禁时长 (15分钟)
})

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!internalConfig.config) {
    return res.status(500).json({ message: 'config error' })
  }

  // ⭐️ 重要: 确保Express应用设置了 'trust proxy'
  // 例如: app.set('trust proxy', 1);
  const ip = req.ip as string

  // 1. 检查IP状态
  const status = authLimiter.check(ip)
  if (status.isBanned) {
    console.info(`[${ip}] Too many failed attempts. Please try again in ${status.timeLeft} minutes.`)

    return res.status(403).json({
      message: 'Forbidden: Too many failed attempts',
    })
  }

  const fromHeader = req.headers.authorization
  const fromCookie = req.cookies?.[AUTH_TOKEN_COOKIE_KEY]
  const token = fromHeader || fromCookie

  // 2. 验证Token
  if (token === internalConfig.authToken) {
    if (!isExplicitDevMode() && !fromHeader && !SAFE_METHODS.has(req.method)) {
      const csrfToken = req.header(CSRF_HEADER_KEY)
      if (!csrfToken || csrfToken !== fromCookie) {
        return res.status(403).json({ message: 'Forbidden' })
      }
    }
    // 验证成功，通知limiter
    authLimiter.recordSuccess(ip)
    return next()
  }

  // 3. 验证失败，通知limiter
  authLimiter.recordFailure(ip)
  return res.status(401).json({ message: 'Unauthorized' })
}
