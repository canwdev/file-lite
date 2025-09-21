import rateLimit from 'express-rate-limit'

const skipPathMap = {
  '/files/stream': true,
  '/files/download': true,
  '/files/upload-file': true,
}

// https://express-rate-limit.mintlify.app/reference/configuration
export const limiter = rateLimit({
  // 限制时间窗口：1 分钟 (x * 60 秒 * 1000 毫秒)
  windowMs: 60 * 1000,
  // 每个 IP 在一个窗口期内最多允许 x 次请求
  limit: 1000,
  message: {message: 'Too many requests, please try again later.'},
  skip: (req, res) => {
    return skipPathMap[req.path] || false
  },
})
