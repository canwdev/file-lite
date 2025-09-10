import express from 'express'
import {
  copyPastePath,
  createDirectory,
  deletePath,
  downloadPath,
  getDrivers,
  getFiles,
  getFileStream,
  renamePath,
} from '@/routes/files/controller'

const filesRouter = express.Router()

filesRouter.get('/drivers', getDrivers)
filesRouter.get('/list', getFiles)
filesRouter.post('/create-dir', createDirectory)
filesRouter.post('/rename', renamePath)
filesRouter.post('/copy-paste', copyPastePath)
filesRouter.post('/delete', deletePath)

filesRouter.get('/stream', getFileStream)
filesRouter.get('/download', downloadPath)

export {filesRouter}
