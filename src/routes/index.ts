import { PKG_NAME, VERSION } from '@frontend/enum/version.ts'
import express from 'express'
import { authMiddleware } from '@/middlewares/auth.ts'
import { errorHandler } from '@/middlewares/error-handler.ts'
import { limiter } from '@/middlewares/limiter.ts'
import filesRouter from './files/index'

const router = express.Router()

router.use(limiter)
router.get('/', (req, res) => {
  res.json({
    name: PKG_NAME,
    version: VERSION,
    timestamp: Date.now(),
  })
})
router.use('/files', authMiddleware, filesRouter)
router.use(errorHandler)

export default router
