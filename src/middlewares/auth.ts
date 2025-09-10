import {Request, Response, NextFunction} from 'express'
import {authPassword, config} from '@/enum/config.ts'

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (config.noAuth) {
    next()
    return
  }
  const password = req.headers['authorization'] || req.query.auth
  if (password !== authPassword) {
    res.status(401).json({message: 'authorization failed'})
    return
  }
  next()
}
