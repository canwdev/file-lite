import getPort, {portNumbers} from 'get-port'
import {filesRouter} from '@/routes/files/index.ts'
import express from 'express'
import path from 'path'
import {errorHandler} from '@/middlewares/error-handler.ts'

const startServer = async () => {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({extended: true}))

  // 配置静态资源服务
  app.use('/', express.static(path.resolve(process.cwd(), './frontend'), {}))
  app.use('/api/files', filesRouter)
  app.use(errorHandler)

  const port = await getPort({port: portNumbers(3100, 4100)})

  app.listen(port, '127.0.0.1', () => {
    console.log(`Server is running at http://${host}:${port}`)
  })
  const host = '127.0.0.1'
}
await startServer()
