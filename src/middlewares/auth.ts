import {Request, Response, NextFunction} from 'express'
import {authToken, config} from '@/enum/config.ts'

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (config.noAuth) {
    next()
    return
  }
  const token = req.headers['authorization'] || req.query.auth
  console.log(token)
  if (token !== authToken) {
    res.status(401).json({message: 'authorization failed'})
    return
  }
  next()
}
