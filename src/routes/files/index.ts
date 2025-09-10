import express from 'express'
import {getDrivers, getFiles, getFileStream} from '@/routes/files/controller'

const filesRouter = express.Router()

filesRouter.get('/drivers', getDrivers)
filesRouter.get('/list', getFiles)
filesRouter.get('/stream', getFileStream)

export {filesRouter}
