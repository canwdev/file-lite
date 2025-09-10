import express from 'express'
import filesRouter from './files/index'
import {authMiddleware} from '@/middlewares/auth.ts'
import {errorHandler} from '@/middlewares/error-handler.ts'
import {PKG_NAME, VERSION} from '@/enum/version.ts'

const router = express.Router()

router.get('/', (req, res) => {
  res.json({
    message: `Server is running`,
    name: PKG_NAME,
    version: VERSION,
  })
})
router.use('/files', authMiddleware, filesRouter)
router.use(errorHandler)

export default router
