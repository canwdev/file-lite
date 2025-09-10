import getPort, {portNumbers} from 'get-port'
import {filesRouter} from '@/routes/files/index.ts'
import express from 'express'
import path from 'path'
import {errorHandler} from '@/middlewares/error-handler.ts'
import os from 'os'

const printServerRunningOn = (host, port, params = '') => {
  const ifaces = os.networkInterfaces()
  const protocol = 'http://'
  const localhostUrl = protocol + '127.0.0.1' + ':' + port

  console.log(`Listening on: ${host}:${port}\n${localhostUrl}${params}`)
  const urls: string[] = []
  if (host === '0.0.0.0') {
    Object.keys(ifaces).forEach((dev) => {
      ifaces[dev].forEach((details) => {
        if (details.family === 'IPv4') {
          const url = protocol + details.address + ':' + port + params
          urls.push(url)
        }
      })
    })
    console.log(`Available on:\n${urls.join('\n')}`)
  }

  return {
    localhostUrl,
    urls,
  }
}

const startServer = async () => {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({extended: true}))

  // 配置静态资源服务
  app.use('/', express.static(path.resolve(process.cwd(), './frontend'), {}))
  app.use('/api/files', filesRouter)
  app.use(errorHandler)

  const port = Number(process.env.PORT || (await getPort({port: portNumbers(3100, 4100)})))
  const host = process.env.HOST || '0.0.0.0'
  app.listen(port, host, () => {
    printServerRunningOn(host, port)
  })
}
await startServer()
