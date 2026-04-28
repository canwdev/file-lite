import express from 'express'
import { consumeAuthTicket, createAuthJwt, internalConfig } from '@/config/config.ts'
import { authMiddleware } from '@/middlewares/auth.ts'
import { errorHandler } from '@/middlewares/error-handler.ts'
import { limiter } from '@/middlewares/limiter.ts'
import filesRouter from './files/index'

const router = express.Router()

router.use(limiter)
router.get('/', (req, res) => {
  res.status(204).send()
})
router.post('/files/auth', (req, res) => {
  if (!internalConfig.config) {
    return res.status(500).json({ message: 'config error' })
  }
  if (req.body?.ticket) {
    const token = consumeAuthTicket(req.body.ticket)
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' })
    }
    return res.status(200).json({ token })
  }
  if (req.body?.password !== internalConfig.config.password) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  return res.status(200).json({ token: createAuthJwt(internalConfig.jwtToken) })
})
router.use('/files', authMiddleware, filesRouter)
router.use(errorHandler)

export default router
