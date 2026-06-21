declare module 'ws' {
  import type { EventEmitter } from 'node:events'
  import type { Server as HttpServer, IncomingMessage } from 'node:http'

  import type { Server as HttpsServer } from 'node:https'
  import type { Socket } from 'node:net'

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number
    readyState: number
    send(data: string): void
    close(): void
    on(event: 'message', listener: (data: string | Buffer) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'error', listener: (error?: Error) => void): this
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { noServer: true })
    clients: Set<WebSocket>
    handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer, callback: (ws: WebSocket) => void): void
    close(): void
    on(event: 'connection', listener: (ws: WebSocket, request: IncomingMessage) => void): this
    emit(event: 'connection', ws: WebSocket, request: IncomingMessage): boolean
  }
}
