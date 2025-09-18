import express from 'express'
import filesRouter from './files/index'
import {authLimiter, authMiddleware} from '@/middlewares/auth.ts'
import {errorHandler} from '@/middlewares/error-handler.ts'
import {PKG_NAME, VERSION} from '@/enum/version.ts'
import {limiter} from '@/middlewares/limiter.ts'

const router = express.Router()

router.use(limiter)
router.get('/', (req, res) => {
  res.json({
    name: PKG_NAME,
    version: VERSION,
    timestamp: Date.now(),
  })
})
router.use(
  '/files',
  // 关键：将两个中间件以数组形式传入，限制器在前！
  [authLimiter, authMiddleware],
  filesRouter,
)
router.use(errorHandler)

export default router
