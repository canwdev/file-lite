// import {serve} from 'bun'
// import { serveStatic } from 'hono/bun'
import {serve} from '@hono/node-server'
import {serveStatic} from '@hono/node-server/serve-static'
// import {getConnInfo} from '@hono/node-server/conninfo'
// import {ipRestriction} from 'hono/ip-restriction'
import {Hono} from 'hono'
// import {cors} from 'hono/cors'
import getPort, {portNumbers} from 'get-port'
import Path from 'path'
import {filesRouter} from '@/routes/files/index.ts'

const startServer = async () => {
  const app = new Hono()
  app.use('/*', serveStatic({root: Path.join(process.cwd(), './frontend')}))
  // app.use('/api/*', cors())
  app.route('/api/files', filesRouter)

  const port = await getPort({port: portNumbers(3100, 4100)})

  const server = serve({
    port: port,
    hostname: '127.0.0.1',
    fetch: app.fetch,
  })
  const url = `http://127.0.0.1:${port}`
  return {port, server, url}
}

const {url} = await startServer()

console.log(`Running on: ${url}`)
