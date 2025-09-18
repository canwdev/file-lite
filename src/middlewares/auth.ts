import rateLimit from 'express-rate-limit'
import {Request, Response, NextFunction} from 'express'
import {authToken, config} from '@/enum/config.ts'

// https://express-rate-limit.mintlify.app/reference/configuration
export const authLimiter = rateLimit({
  // 限制时间窗口：1 分钟 (x * 60 秒 * 1000 毫秒)
  windowMs: 1 * 60 * 1000,

  // 每个 IP 在一个窗口期内最多允许 x 次请求
  limit: async (req, res) => {
    const token = req.headers['authorization'] || req.query.auth
    return token === authToken ? Infinity : 10
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers

  // 当达到限制时返回的提示信息
  message: {message: 'Auth failed, too many requests, please try again later.'},

  // 这是实现需求的关键！
  // 设置为 true，则只有失败的请求才会被计数。
  // 由于：Technically, the requests are counted and then un-counted, so a large number of slow requests all at once could still trigger a rate-limit. This may be fixed in a future release. PRs welcome!
  // 请勿在高频请求下使用此选项，否则可能会触发 429。
  // skipSuccessfulRequests: true,
  // // 自定义判断请求是否成功的函数
  // requestWasSuccessful: (req, res) => {
  //   const token = req.headers['authorization'] || req.query.auth
  //   return token === authToken
  // },
})
// 使用示例：
// router.use(
//   '/files',
//   // 关键：将两个中间件以数组形式传入，限制器在前！
//   // [authLimiter, authMiddleware],
//   filesRouter,
// )

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (config.noAuth) {
    next()
    return
  }
  const token = req.headers['authorization'] || req.query.auth
  // console.info('auth token', token)
  if (token !== authToken) {
    res.status(401).json({message: 'authorization failed'})
    return
  }
  next()
}
