import type { Server as HttpServer } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { encodeIpSelectorParams } from '@frontend/utils/ip-selector-codec.ts'
import cookieParser from 'cookie-parser'
import express from 'express'
import fallback from 'express-history-api-fallback'
import getPort, { portNumbers } from 'get-port'
import morgan from 'morgan'
import { createAuthTicket, internalConfig } from '@/config/config'
import router from '@/routes'
import { opener, printServerRunningOn } from '@/utils/server-utils.ts'
import { attachSharedWsServer } from '@/ws/server.ts'

let server: HttpsServer | HttpServer | null = null
let detachSharedWs: (() => void) | null = null

export interface StartServerResult {
  urlIpSelector: string
  printUrls: () => void
}

export function isServerRunning() {
  return server !== null
}

export async function startServer(): Promise<StartServerResult> {
  if (server) {
    throw new Error('server is already running')
  }

  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use(cookieParser())

  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const frontendRoot = [
    path.resolve(moduleDir, 'frontend'),
    path.resolve(moduleDir, '../frontend'),
  ].find(candidate => fs.existsSync(candidate)) ?? path.resolve(moduleDir, 'frontend')
  app.use('/', express.static(frontendRoot))

  if (internalConfig.config?.enableLog) {
    app.use(
      morgan('[:date[iso]] [:remote-addr] [:status] [:method] :url', {
        skip(_req, res) {
          return res.statusCode < 400
        },
      }),
    )
  }

  app.use('/api', router)
  app.use(fallback('index.html', { root: frontendRoot }))

  const port = Number(
    internalConfig.config?.port || process.env.PORT || (await getPort({ port: portNumbers(3100, 4100) })),
  )
  const host = internalConfig.config?.host || process.env.HOST || '0.0.0.0'
  const isHttps = Boolean(internalConfig.config?.sslKey && internalConfig.config?.sslCert)

  const serverResult: StartServerResult = {
    urlIpSelector: '',
    printUrls: () => {},
  }

  return new Promise((resolve) => {
    const listenCallback = () => {
      const printUrls = () => {
        console.log('')
        const ticket = createAuthTicket()
        const ticketParam = `ticket=${ticket.value}`
        const protocol = isHttps ? 'https:' : 'http:'
        const frontendPort = Number(process.env.FILE_LITE_FE_PORT) || port

        const { localhostUrl, ips } = printServerRunningOn({
          protocol,
          host,
          port: frontendPort,
          params: `?${ticketParam}`,
        })
        console.log('IP Selector:')
        serverResult.urlIpSelector = `${localhostUrl}/ip?data=${encodeIpSelectorParams({
          ips,
          port: frontendPort,
          protocol,
          ticket: ticket.value,
        })}`
        console.log(serverResult.urlIpSelector)
        console.log('')
        console.log(`Ticket: ${ticket.value}`)
        console.log(`Ticket expires at: ${new Date(ticket.expiresAt).toLocaleString()}.`)
        console.log('')
      }
      serverResult.printUrls = printUrls
      printUrls()
      resolve(serverResult)
    }

    if (isHttps) {
      console.log('HTTPS enabled')
      const options = {
        key: fs.readFileSync(path.resolve(internalConfig.dataBaseDir, internalConfig.config?.sslKey as string)),
        cert: fs.readFileSync(path.resolve(internalConfig.dataBaseDir, internalConfig.config?.sslCert as string)),
      }
      server = https.createServer(options, app).listen(port, host, listenCallback)
    }
    else {
      server = app.listen(port, host, listenCallback)
    }
    detachSharedWs = attachSharedWsServer(server)
  })
}

export function stopServer() {
  return new Promise<void>((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => {
      detachSharedWs?.()
      detachSharedWs = null
      server = null
      console.log('server stopped')
      resolve()
    })
  })
}

export async function openIpSelector(result: StartServerResult) {
  result.printUrls()
  await opener(result.urlIpSelector)
}
