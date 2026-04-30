declare module 'express-history-api-fallback' {
  import type { RequestHandler } from 'express'
  import type { SendFileOptions } from 'express-serve-static-core'

  export default function fallback(path: string, options?: SendFileOptions): RequestHandler
}
