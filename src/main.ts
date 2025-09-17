import getPort, {portNumbers} from 'get-port'
import express from 'express'
import path from 'path'
import os from 'os'
import {authToken, config, DATA_BASE_DIR} from './enum/config'
import morgan from 'morgan'
import router from '@/routes'
import https from 'https'
import fs from 'fs'
import fallback from 'express-history-api-fallback'

const printServerRunningOn = ({protocol = 'http:', host, port, params = ''}) => {
  const ifaces = os.networkInterfaces()
  const localhostUrl = protocol + '//' + '127.0.0.1' + ':' + port

  console.log(`Listening on: ${host}:${port}\n${localhostUrl}${params}`)
  const urls: string[] = []
  if (host === '0.0.0.0') {
    Object.keys(ifaces).forEach((dev) => {
      ifaces[dev]?.forEach((details) => {
        if (details.family === 'IPv4') {
          const url = protocol + '//' + details.address + ':' + port + params
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
  const frontendRoot = path.resolve(process.cwd(), './frontend')
  app.use('/', express.static(frontendRoot))

  if (config.enableLog) {
    app.use(morgan('[:date[iso]] [:remote-addr] [:status] [:method] :url'))
  }
  // 路由配置
  app.use('/api', router)
  app.use(fallback('index.html', {root: frontendRoot}))

  const port = Number(
    config.port || process.env.PORT || (await getPort({port: portNumbers(3100, 4100)})),
  )
  const host = config.host || process.env.HOST || '0.0.0.0'

  const listenCallback = () => {
    console.log(``)
    const {localhostUrl, urls} = printServerRunningOn({
      protocol: 'http:',
      host,
      port,
      params: `?auth=${authToken}`,
    })
    console.log(`IP Selector:`)
    console.log(`${localhostUrl}/ip?urls=${btoa(JSON.stringify(urls))}`)
  }

  if (config.sslKey && config.sslCert) {
    const options = {
      key: fs.readFileSync(path.resolve(DATA_BASE_DIR, config.sslKey)),
      cert: fs.readFileSync(path.resolve(DATA_BASE_DIR, config.sslCert)),
    }
    https.createServer(options, app).listen(port, host, listenCallback)
  } else {
    app.listen(port, host, listenCallback)
  }
}
await startServer()
