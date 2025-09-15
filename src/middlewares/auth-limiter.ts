import rateLimit from 'express-rate-limit'

export const authLimiter = rateLimit({
  // 限制时间窗口：1 小时 (60 分钟 * 60 秒 * 1000 毫秒)
  windowMs: 60 * 60 * 1000,

  // 每个 IP 在一个窗口期内最多允许 5 次请求
  limit: 5,

  // 当达到限制时返回的提示信息
  message: '认证失败次数过多，请一小时后再试。',

  // 使用推荐的标准头信息来传递速率限制信息
  // （RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset）
  standardHeaders: 'draft-7',

  // 不使用旧版的 'X-RateLimit-*' 头信息
  legacyHeaders: false,

  // 这是实现需求的关键！
  // 设置为 true，则只有失败的请求（响应状态码为 4xx 或 5xx）才会被计数。
  // 成功的请求（2xx）不会被计数。
  skipSuccessfulRequests: true,
})
