import type { Request, Response } from 'express'

export function errorHandler(err: any, req: Request, res: Response) {
  console.error(err)

  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal Server Error'

  res.status(statusCode).json({ message })
}
