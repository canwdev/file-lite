import type { Server as HttpServer } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import * as process from 'node:process'
import { fileURLToPath } from 'node:url'
import { PKG_NAME, VERSION } from '@frontend/enum/version.ts'
import enquirer from 'enquirer'
import express from 'express'
import fallback from 'express-history-api-fallback'
import getPort, { portNumbers } from 'get-port'
import morgan from 'morgan'
import { internalConfig, loadConfig } from '@/config/config'
import router from '@/routes'
import { opener, printServerRunningOn } from './utils/server-utils.ts'

function sleep(t: number) {
  return new Promise(resolve => setTimeout(resolve, t))
}

let server: HttpsServer | HttpServer | null = null

interface StartServerResult {
  urlIpSelector: string
  printUrls: () => void
}

function startServer(): Promise<StartServerResult> {
  if (server) {
    throw new Error('server is already running')
  }

  return new Promise(async (resolve) => {
    const app = express()
    app.set('trust proxy', 1)
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    // 配置静态资源服务
    const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './frontend')
    // console.log('frontendRoot', frontendRoot)

    app.use('/', express.static(frontendRoot))

    if (internalConfig.config?.enableLog) {
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
      internalConfig.config?.port || process.env.PORT || (await getPort({ port: portNumbers(3100, 4100) })),
    )
    const host = internalConfig.config?.host || process.env.HOST || '0.0.0.0'

    const isHttps = internalConfig.config?.sslKey && internalConfig.config?.sslCert
    const listenCallback = async () => {
      let urlIpSelector = ''
      const printUrls = () => {
        console.log(``)
        const authParam = internalConfig.config?.noAuth ? '' : `auth=${internalConfig.authToken}`
        const protocol = isHttps ? 'https:' : 'http:'
        const { localhostUrl, ips } = printServerRunningOn({
          protocol,
          host,
          port,
          params: authParam ? `?${authParam}` : '',
        })
        console.log(`IP Selector:`)
        urlIpSelector = `${localhostUrl}/ip?data=${btoa(JSON.stringify({ ips, port, protocol, auth: internalConfig.config?.noAuth ? '' : (internalConfig.authToken || '') }))}`
        console.log(urlIpSelector)
        console.log('')
      }
      printUrls()
      resolve({ urlIpSelector, printUrls })
    }

    if (isHttps) {
      console.log(`HTTPS enabled`)
      const options = {
        key: fs.readFileSync(path.resolve(internalConfig.dataBaseDir, internalConfig.config?.sslKey as string)),
        cert: fs.readFileSync(path.resolve(internalConfig.dataBaseDir, internalConfig.config?.sslCert as string)),
      }
      server = https.createServer(options, app).listen(port, host, listenCallback)
    }
    else {
      server = app.listen(port, host, listenCallback)
    }
  })
}

function stopServer() {
  return new Promise((resolve, reject) => {
    if (!server) {
      console.error('server is not running')
      return
    }
    server.close(() => {
      server = null
      console.log('server stopped')
      resolve(null)
    })
  })
}

async function main() {
  let isExit = false
  let isPrint = false
  let isCreateConfig = false
  let serverResult: StartServerResult
  while (!isExit) {
    if (!server) {
      loadConfig({ allowCreate: isCreateConfig })
      serverResult = await startServer()
    }
    else if (isPrint) {
      console.clear()
      serverResult!.printUrls()
    }
    isPrint = false
    isCreateConfig = false
    type FnType = 'ip' | 'print' | 'openConfig' | 'createConfig' | 'reload' | 'exit'
    const { selectedFn }: { selectedFn: FnType } = await enquirer.prompt([{
      type: 'select',
      name: 'selectedFn',
      message: `📁 ${PKG_NAME} v${VERSION} Select function`,
      choices: [
        { message: '🌐 Open IP selector', name: 'ip' },
        { message: '🔗 Print urls', name: 'print' },
        internalConfig.configInitialized ? { message: '⚙️ Open config file', name: 'openConfig' } : { message: '✨  Create config file', name: 'createConfig' },
        { message: '🔄 Restart server', name: 'reload' },
        { message: '🚪 Exit', name: 'exit' },
      ].filter(Boolean),
    }])
    if (selectedFn === 'ip') {
      await opener(serverResult!.urlIpSelector)
      await sleep(1000)
      continue
    }
    if (selectedFn === 'print') {
      isPrint = true
      continue
    }
    if (selectedFn === 'openConfig') {
      if (internalConfig.configInitialized) {
        await opener(internalConfig.configFilePath)
      }
      continue
    }
    if (selectedFn === 'createConfig') {
      await stopServer()
      isCreateConfig = true
      continue
    }
    if (selectedFn === 'reload') {
      await stopServer()
      continue
    }
    if (selectedFn === 'exit') {
      await stopServer()
      isExit = true
      continue
    }
  }
  process.exit(0)
}
main()
