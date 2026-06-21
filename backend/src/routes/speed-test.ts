import { once } from 'node:events'
import express from 'express'

const speedTestRouter = express.Router()

const ONE_MB = 1024 * 1024
const DEFAULT_SIZE_MB = 500
const MAX_SIZE_MB = 2048
const downloadChunk = Buffer.alloc(ONE_MB, 'a')

function getSizeMB(value: unknown) {
  const size = Number(value)
  if (!Number.isFinite(size) || size <= 0) {
    return DEFAULT_SIZE_MB
  }
  return Math.min(Math.floor(size), MAX_SIZE_MB)
}

speedTestRouter.get('/download', async (req, res) => {
  const sizeMB = getSizeMB(req.query.sizeMB)

  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Length', String(sizeMB * ONE_MB))
  res.setHeader('Cache-Control', 'no-store')

  for (let i = 0; i < sizeMB; i++) {
    if (!res.write(downloadChunk)) {
      await once(res, 'drain')
    }
  }
  res.end()
})

speedTestRouter.post(
  '/upload',
  express.raw({ type: '*/*', limit: `${MAX_SIZE_MB}mb` }),
  (req, res) => {
    res.status(200).json({
      ok: true,
      bytes: Buffer.isBuffer(req.body) ? req.body.length : 0,
    })
  },
)

export default speedTestRouter
