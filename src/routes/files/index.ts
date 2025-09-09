import {Hono} from 'hono'
import {getDrivers, getFiles, getFileStream} from '@/routes/files/controller'

const filesRouter = new Hono()

filesRouter.get('/drivers', getDrivers)
filesRouter.get('/list', getFiles)
filesRouter.get('/stream', getFileStream)

export {filesRouter}
