import express from 'express'
import { authMiddleware } from '@/middlewares/auth.ts'
import { errorHandler } from '@/middlewares/error-handler.ts'
import { limiter } from '@/middlewares/limiter.ts'
import filesRouter from './files/index'

const router = express.Router()

router.use(limiter)
router.get('/', (req, res) => {
  res.status(204).send()
})
router.use('/files', authMiddleware, filesRouter)
router.use(errorHandler)

export default router
