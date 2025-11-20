import type { NextFunction, Request, Response } from 'express'
import { internalConfig } from '@/config/config.ts'
import { IPRateLimiter } from './auth-limiter'

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

  if (internalConfig.config.noAuth) {
    return next()
  }
  // ⭐️ 重要: 确保Express应用设置了 'trust proxy'
  // 例如: app.set('trust proxy', 1);
  const ip = req.ip as string

  // 1. 检查IP状态
  const status = authLimiter.check(ip)
  if (status.isBanned) {
    return res.status(403).json({
      message: `Too many failed attempts. Please try again in ${status.timeLeft} minutes.`,
    })
  }

  const token = req.headers.authorization || req.query.auth

  // 2. 验证Token
  if (token === internalConfig.authToken) {
    // 验证成功，通知limiter
    authLimiter.recordSuccess(ip)
    return next()
  }

  // 3. 验证失败，通知limiter
  authLimiter.recordFailure(ip)
  return res.status(401).json({ message: 'Authorization failed' })
}
