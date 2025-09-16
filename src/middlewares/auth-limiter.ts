import rateLimit from 'express-rate-limit'

// https://express-rate-limit.mintlify.app/reference/configuration
export const authLimiter = rateLimit({
  // 限制时间窗口：1 小时 (60 分钟 * 60 秒 * 1000 毫秒)
  windowMs: 60 * 60 * 1000,

  // 每个 IP 在一个窗口期内最多允许 5 次请求
  limit: 5,

  // 当达到限制时返回的提示信息
  message: 'Auth failed, too many requests, please try again after 1 hour.',
  handler: (req, res, next, options) =>
    res.status(options.statusCode).send({
      message: options.message,
    }),

  // 使用推荐的标准头信息来传递速率限制信息
  // （RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset）
  standardHeaders: 'draft-7',

  // 不使用旧版的 'X-RateLimit-*' 头信息
  legacyHeaders: false,

  // 这是实现需求的关键！
  // 设置为 true，则只有失败的请求（响应状态码为 4xx 或 5xx）才会被计数。
  // 成功的请求（2xx）不会被计数。
  skipSuccessfulRequests: true,

  // 自定义判断请求是否成功的函数
  requestWasSuccessful: (req, res) => {
    const statusCode = res.statusCode
    // console.log('requestWasSuccessful', statusCode, req.path, statusCode !== 401)
    // 只有 401 状态码才被认为是失败的请求
    return statusCode !== 401
  },
})
