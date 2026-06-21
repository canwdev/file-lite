import type {
  SettingsClientMessage,
  SettingsServerMessage,
  SharedWsClientMessage,
  SharedWsServerMessage,
  TextSyncChannel,
  TextSyncClientMessage,
  TextSyncServerMessage,
  WsErrorMessage,
} from '@frontend/types/server.ts'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import type { Socket } from 'node:net'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import { TEXT_SYNC_CHANNELS } from '@frontend/types/server.ts'
import { WebSocket, WebSocketServer } from 'ws'
import { internalConfig, verifyAuthJwt } from '@/config/config.ts'
import { deleteSettingsValue, getAllSettingsValues, getSettingsValue, reloadSettingsStore, setSettingsValue } from '@/utils/settings-store.ts'

const SHARED_WS_PATH = '/api/ws'
const MAX_TEXT_SYNC_LENGTH = 64 * 1024
const MAX_CONNECTIONS_PER_IP = 20
const textSyncChannelSet = new Set<TextSyncChannel>(TEXT_SYNC_CHANNELS)

interface SharedWsClientState {
  ws: WebSocket
  textSyncChannel: TextSyncChannel | null
  ip: string
}

interface TextSyncChannelState {
  text: string
  clients: Set<SharedWsClientState>
}

const ipConnectionMap = new Map<string, number>()
const channelStateMap = new Map<TextSyncChannel, TextSyncChannelState>()
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

function cleanupChannelIfEmpty(channel: TextSyncChannel) {
  const state = channelStateMap.get(channel)
  if (state && state.clients.size === 0) {
    channelStateMap.delete(channel)
  }
}

function getOrCreateChannelState(channel: TextSyncChannel): TextSyncChannelState {
  const state = channelStateMap.get(channel)
  if (state) {
    return state
  }
  const created: TextSyncChannelState = {
    text: '',
    clients: new Set<SharedWsClientState>(),
  }
  channelStateMap.set(channel, created)
  return created
}

function joinTextSyncChannel(client: SharedWsClientState, channel: TextSyncChannel) {
  if (client.textSyncChannel) {
    const prevState = channelStateMap.get(client.textSyncChannel)
    prevState?.clients.delete(client)
    cleanupChannelIfEmpty(client.textSyncChannel)
  }

  const currentState = getOrCreateChannelState(channel)
  currentState.clients.add(client)
  client.textSyncChannel = channel

  sendJson(client.ws, {
    scope: 'text-sync',
    type: 'sync',
    channel,
    text: currentState.text,
  })
}

function isTextWithinLimit(text: string): boolean {
  return Buffer.byteLength(text, 'utf8') <= MAX_TEXT_SYNC_LENGTH
}

function broadcastTextSync(message: TextSyncServerMessage) {
  if (message.type !== 'sync') {
    return
  }
  const state = channelStateMap.get(message.channel)
  if (!state) {
    return
  }
  for (const client of state.clients) {
    sendJson(client.ws, message)
  }
}

function handleTextSyncUpdate(client: SharedWsClientState, payload: Extract<TextSyncClientMessage, { type: 'update' }>) {
  if (!client.textSyncChannel || payload.channel !== client.textSyncChannel) {
    sendError(client.ws, { scope: 'text-sync', type: 'error', message: 'Channel mismatch' })
    return
  }
  if (typeof payload.text !== 'string' || !isTextWithinLimit(payload.text)) {
    sendError(client.ws, { scope: 'text-sync', type: 'error', message: `Text exceeds ${MAX_TEXT_SYNC_LENGTH} bytes` })
    return
  }
  const state = getOrCreateChannelState(client.textSyncChannel)
  state.text = payload.text
  broadcastTextSync({
    scope: 'text-sync',
    type: 'sync',
    channel: client.textSyncChannel,
    text: state.text,
  })
}

function broadcastSettings(message: SettingsServerMessage) {
  if (message.type !== 'sync') {
    return
  }
  for (const client of connectedClients) {
    sendJson(client.ws, message)
  }
}

function broadcastSettingsSnapshot(previous: Record<string, unknown>, current: Record<string, unknown>) {
  const keys = new Set([
    ...Object.keys(previous),
    ...Object.keys(current),
  ])
  for (const key of keys) {
    broadcastSettings({
      scope: 'settings',
      type: 'sync',
      key,
      value: key in current ? current[key] as any : null,
    })
  }
}

async function syncSettingsToClient(client: SharedWsClientState) {
  const store = await getAllSettingsValues()
  for (const [key, value] of Object.entries(store)) {
    sendJson(client.ws, {
      scope: 'settings',
      type: 'sync',
      key,
      value,
    })
  }
}

async function handleSettingsMessage(client: SharedWsClientState, payload: SettingsClientMessage) {
  try {
    if (payload.type === 'get') {
      const value = await getSettingsValue(payload.key)
      sendJson(client.ws, {
        scope: 'settings',
        type: 'response',
        requestId: payload.requestId,
        action: 'get',
        key: payload.key,
        value,
      })
      return
    }
    if (payload.type === 'set') {
      const value = await setSettingsValue(payload.key, payload.value as any)
      const response: SettingsServerMessage = {
        scope: 'settings',
        type: 'response',
        requestId: payload.requestId,
        action: 'set',
        key: payload.key,
        value,
      }
      sendJson(client.ws, response)
      broadcastSettings({
        scope: 'settings',
        type: 'sync',
        key: payload.key,
        value,
      })
      return
    }

    const value = await deleteSettingsValue(payload.key)
    sendJson(client.ws, {
      scope: 'settings',
      type: 'response',
      requestId: payload.requestId,
      action: 'delete',
      key: payload.key,
      value,
    })
    broadcastSettings({
      scope: 'settings',
      type: 'sync',
      key: payload.key,
      value,
    })
  }
  catch (error: any) {
    sendError(client.ws, {
      scope: 'settings',
      type: 'error',
      message: error?.message || 'Settings request failed',
      requestId: payload.requestId,
    })
  }
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
    if (payload.type === 'set' && !Object.prototype.hasOwnProperty.call(payload, 'value')) {
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
      textSyncChannel: null,
      ip: getRequestIp(request),
    }
    connectedClients.add(client)
    void syncSettingsToClient(client)

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
        if (payload.type === 'join') {
          joinTextSyncChannel(client, payload.channel)
          return
        }
        handleTextSyncUpdate(client, payload)
        return
      }
      void handleSettingsMessage(client, payload)
    })

    ws.on('close', () => {
      connectedClients.delete(client)
      if (client.textSyncChannel) {
        const channel = client.textSyncChannel
        const state = channelStateMap.get(channel)
        state?.clients.delete(client)
        cleanupChannelIfEmpty(channel)
      }
      consumeIpConnection(client.ip)
    })

    ws.on('error', () => {
      ws.close()
    })
  })

  server.on('upgrade', upgradeHandler)

  return () => {
    server.off('upgrade', upgradeHandler)
    wsServer.close()
    channelStateMap.clear()
    connectedClients.clear()
    ipConnectionMap.clear()
  }
}

export async function reloadSharedWsSettings() {
  const { previous, current } = await reloadSettingsStore()
  broadcastSettingsSnapshot(previous, current)
}
