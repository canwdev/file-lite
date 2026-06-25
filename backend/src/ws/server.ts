import type {
  SettingsClientMessage,
  SharedWsClientMessage,
  SharedWsServerMessage,
  TextSyncChannel,
  TextSyncClientMessage,
  WsErrorMessage,
} from '@frontend/types/server.ts'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import type { Socket } from 'node:net'
import type { WebSocket } from 'ws'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import { TEXT_SYNC_CHANNELS } from '@frontend/types/server.ts'
import { WebSocketServer } from 'ws'
import { internalConfig, verifyAuthJwt } from '@/config/config.ts'
import { createSettingsSyncController } from '@/ws/settings-sync.ts'
import { createTextSyncController } from '@/ws/text-sync.ts'

const SHARED_WS_PATH = '/api/ws'
const MAX_CONNECTIONS_PER_IP = 20
const textSyncChannelSet = new Set<TextSyncChannel>(TEXT_SYNC_CHANNELS)

interface SharedWsClientState {
  ws: WebSocket
  ip: string
}

const ipConnectionMap = new Map<string, number>()
const connectedClients = new Set<SharedWsClientState>()

function getCookieValue(cookie: string, name: string): string {
  const prefix = `${name}=`
  for (const part of cookie.split(';')) {
    const value = part.trim()
    if (value.startsWith(prefix)) {
      return decodeURIComponent(value.slice(prefix.length))
    }
  }
  return ''
}

function getRequestIp(request: IncomingMessage): string {
  const xff = request.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown'
  }
  return request.socket.remoteAddress || 'unknown'
}

function isOriginAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin || !request.headers.host) {
    return true
  }
  try {
    const originUrl = new URL(origin)
    const requestHost = request.headers.host.split(':')[0]?.toLowerCase() || ''
    const originHost = originUrl.hostname.toLowerCase()
    if (originHost === requestHost) {
      return true
    }
    const localhostGroup = new Set(['localhost', '127.0.0.1', '::1'])
    return localhostGroup.has(originHost) && localhostGroup.has(requestHost)
  }
  catch {
    return false
  }
}

function getAuthToken(request: IncomingMessage): string {
  const url = new URL(request.url || '/', 'http://localhost')
  const fromQuery = url.searchParams.get('token')
  if (fromQuery) {
    return fromQuery
  }
  const fromHeader = request.headers.authorization
  if (typeof fromHeader === 'string' && fromHeader) {
    return fromHeader
  }
  const cookieHeader = request.headers.cookie
  if (typeof cookieHeader === 'string' && cookieHeader) {
    return getCookieValue(cookieHeader, 'file_lite_auth_token')
  }
  return ''
}

function isAuthenticated(request: IncomingMessage): boolean {
  const token = getAuthToken(request)
  if (!token || !internalConfig.jwtToken) {
    return false
  }
  return verifyAuthJwt(token, internalConfig.jwtToken)
}

function sendJson(ws: WebSocket, payload: SharedWsServerMessage): void {
  if (ws.readyState !== 1) {
    return
  }
  ws.send(JSON.stringify(payload))
}

function sendError(ws: WebSocket, payload: WsErrorMessage) {
  sendJson(ws, payload)
}

function parseClientMessage(raw: string): SharedWsClientMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  }
  catch {
    return null
  }
  if (!data || typeof data !== 'object') {
    return null
  }

  const payload = data as Partial<SharedWsClientMessage>
  if (payload.scope === 'text-sync') {
    if ((payload.type !== 'join' && payload.type !== 'update')
      || typeof payload.channel !== 'string'
      || !textSyncChannelSet.has(payload.channel as TextSyncChannel)) {
      return null
    }
    if (payload.type === 'update' && typeof payload.text !== 'string') {
      return null
    }
    return payload as TextSyncClientMessage
  }

  if (payload.scope === 'settings') {
    if ((payload.type !== 'get' && payload.type !== 'set' && payload.type !== 'delete')
      || typeof payload.requestId !== 'string'
      || typeof payload.key !== 'string') {
      return null
    }
    if (payload.type === 'set' && !Object.hasOwn(payload, 'value')) {
      return null
    }
    return payload as SettingsClientMessage
  }

  return null
}

function consumeIpConnection(ip: string) {
  const current = ipConnectionMap.get(ip) ?? 0
  if (current <= 1) {
    ipConnectionMap.delete(ip)
    return
  }
  ipConnectionMap.set(ip, current - 1)
}

function rejectUpgrade(socket: Socket, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export function attachSharedWsServer(server: HttpServer | HttpsServer) {
  const wsServer = new WebSocketServer({ noServer: true })
  const settingsSync = createSettingsSyncController({
    clients: connectedClients,
    sendError,
    sendJson,
  })
  const textSync = createTextSyncController({
    sendError,
    sendJson,
  })
  const detachFrontendStorageWatcher = settingsSync.attachFrontendStorageWatcher()

  const upgradeHandler = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    if (requestUrl.pathname !== SHARED_WS_PATH) {
      return
    }
    if (!isOriginAllowed(request)) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    if (!isAuthenticated(request)) {
      rejectUpgrade(socket, 401, 'Unauthorized')
      return
    }
    const ip = getRequestIp(request)
    const currentConnections = ipConnectionMap.get(ip) ?? 0
    if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
      rejectUpgrade(socket, 429, 'Too Many Requests')
      return
    }

    ipConnectionMap.set(ip, currentConnections + 1)
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit('connection', ws, request)
    })
  }

  wsServer.on('connection', (ws, request) => {
    const client: SharedWsClientState = {
      ws,
      ip: getRequestIp(request),
    }
    connectedClients.add(client)
    void settingsSync.syncSettingsToClient(client)

    ws.on('message', (raw) => {
      if (typeof raw !== 'string' && !(raw instanceof Buffer)) {
        sendError(ws, { scope: 'ws', type: 'error', message: 'Invalid payload type' })
        return
      }
      const payload = parseClientMessage(String(raw))
      if (!payload) {
        sendError(ws, { scope: 'ws', type: 'error', message: 'Invalid payload' })
        return
      }
      if (payload.scope === 'text-sync') {
        textSync.handleTextSyncMessage(client, payload)
        return
      }
      void settingsSync.handleSettingsMessage(client, payload)
    })

    ws.on('close', () => {
      connectedClients.delete(client)
      textSync.removeClient(client)
      consumeIpConnection(client.ip)
    })

    ws.on('error', () => {
      ws.close()
    })
  })

  server.on('upgrade', upgradeHandler)

  return () => {
    detachFrontendStorageWatcher()
    server.off('upgrade', upgradeHandler)
    wsServer.close()
    textSync.clear()
    connectedClients.clear()
    ipConnectionMap.clear()
  }
}
