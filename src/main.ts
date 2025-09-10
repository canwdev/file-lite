import getPort, {portNumbers} from 'get-port'
import express from 'express'
import path from 'path'
import os from 'os'
import {authToken, config} from './enum/config'
import morgan from 'morgan'
import router from '@/routes'

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

  if (config.enableLog) {
    app.use(morgan('[:date[iso]] [:remote-addr] [:status] [:method] :url'))
  }
  // 路由配置
  app.use('/api', router)

  const port = Number(
    config.port || process.env.PORT || (await getPort({port: portNumbers(3100, 4100)})),
  )
  const host = config.host || process.env.HOST || '0.0.0.0'
  app.listen(port, host, () => {
    console.log(``)
    printServerRunningOn(host, port, `?auth=${authToken}`)
    console.log(``)
  })
}
await startServer()
