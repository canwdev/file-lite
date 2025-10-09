import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import * as process from 'node:process'
import express from 'express'
import fallback from 'express-history-api-fallback'
import getPort, { portNumbers } from 'get-port'
import morgan from 'morgan'
import router from '@/routes'
import { authToken, config, DATA_BASE_DIR } from './enum/config'
import { opener, printServerRunningOn } from './utils/server-utils.ts'
import { registerShortcuts } from './utils/shortcut'

async function startServer() {
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // 配置静态资源服务
  const frontendRoot = path.resolve(process.cwd(), './frontend')
  app.use('/', express.static(frontendRoot))

  if (config.enableLog) {
    app.use(
      morgan('[:date[iso]] [:remote-addr] [:status] [:method] :url', {
        skip(req, res) {
          return res.statusCode < 400
        },
      }),
    )
  }
  // 路由配置
  app.use('/api', router)
  app.use(fallback('index.html', { root: frontendRoot }))

  const port = Number(
    config.port || process.env.PORT || (await getPort({ port: portNumbers(3100, 4100) })),
  )
  const host = config.host || process.env.HOST || '0.0.0.0'

  const isHttps = config.sslKey && config.sslCert
  const listenCallback = async () => {
    let urlIpSelector: string
    const printUrls = () => {
      console.log(``)
      const authParam = config.noAuth ? '' : `auth=${authToken}`
      const protocol = isHttps ? 'https:' : 'http:'
      const { localhostUrl, ips } = printServerRunningOn({
        protocol,
        host,
        port,
        params: authParam ? `?${authParam}` : '',
      })
      console.log(`IP Selector:`)
      urlIpSelector = `${localhostUrl}/ip?data=${btoa(JSON.stringify({ ips, port, protocol, auth: config.noAuth ? '' : (authToken || '') }))}`
      console.log(urlIpSelector)
    }
    printUrls()
    await registerShortcuts({
      shortcuts: [
        {
          key: 'o',
          desc: 'Open IP Selector',
          callback: async () => {
            await opener(urlIpSelector)
          },
        },
        {
          key: 'p',
          desc: 'Print URLs',
          callback: () => {
            printUrls()
          },
        },
        {
          key: 'q',
          desc: 'Exit',
          callback: () => {
            process.exit(0)
          },
        },
      ],
    })
  }

  if (isHttps) {
    console.log(`HTTPS enabled`)
    const options = {
      key: fs.readFileSync(path.resolve(DATA_BASE_DIR, config.sslKey)),
      cert: fs.readFileSync(path.resolve(DATA_BASE_DIR, config.sslCert)),
    }
    https.createServer(options, app).listen(port, host, listenCallback)
  }
  else {
    app.listen(port, host, listenCallback)
  }
}
startServer()
