import express from 'express'
import {
  createDirectory,
  getDrivers,
  getFiles,
  getFileStream,
  renamePath,
} from '@/routes/files/controller'

const filesRouter = express.Router()

filesRouter.get('/drivers', getDrivers)
filesRouter.get('/list', getFiles)
filesRouter.get('/stream', getFileStream)
filesRouter.post('/create-dir', createDirectory)
filesRouter.post('/rename', renamePath)

export {filesRouter}
