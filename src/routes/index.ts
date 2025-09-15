import express from 'express'
import filesRouter from './files/index'
import {authMiddleware} from '@/middlewares/auth.ts'
import {errorHandler} from '@/middlewares/error-handler.ts'
import {PKG_NAME, VERSION} from '@/enum/version.ts'
import {authLimiter} from '@/middlewares/auth-limiter'

const router = express.Router()

router.get('/', (req, res) => {
  res.json({
    message: `Server is running`,
    name: PKG_NAME,
    version: VERSION,
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
