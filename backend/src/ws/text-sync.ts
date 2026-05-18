import type { TextSyncChannel, TextSyncClientMessage, TextSyncServerMessage } from '@frontend/types/server.ts'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import type { Socket } from 'node:net'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import { TEXT_SYNC_CHANNELS } from '@frontend/types/server.ts'
import { WebSocketServer } from 'ws'
import { internalConfig, verifyAuthJwt } from '@/config/config.ts'

const TEXT_SYNC_PATH = '/api/files/text-sync'
const MAX_TEXT_SYNC_LENGTH = 64 * 1024
const MAX_CONNECTIONS_PER_IP = 20
const SAFE_CLOSE_WAIT_MS = 60 * 1000

const textSyncChannelSet = new Set<TextSyncChannel>(TEXT_SYNC_CHANNELS)

interface TextSyncClientState {
  ws: import('ws').WebSocket
  channel: TextSyncChannel | null
  ip: string
}

interface TextSyncChannelState {
  text: string
  clients: Set<TextSyncClientState>
}

const ipConnectionMap = new Map<string, number>()
const channelStateMap = new Map<TextSyncChannel, TextSyncChannelState>()

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

function sendJson(ws: import('ws').WebSocket, payload: TextSyncServerMessage): void {
  if (ws.readyState !== 1) {
    return
  }
  ws.send(JSON.stringify(payload))
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
    clients: new Set<TextSyncClientState>(),
  }
  channelStateMap.set(channel, created)
  return created
}

function joinChannel(client: TextSyncClientState, channel: TextSyncChannel) {
  if (client.channel) {
    const prevState = channelStateMap.get(client.channel)
    prevState?.clients.delete(client)
    cleanupChannelIfEmpty(client.channel)
  }

  const currentState = getOrCreateChannelState(channel)
  currentState.clients.add(client)
  client.channel = channel

  sendJson(client.ws, {
    type: 'sync',
    channel,
    text: currentState.text,
  })
}

function isTextWithinLimit(text: string): boolean {
  return Buffer.byteLength(text, 'utf8') <= MAX_TEXT_SYNC_LENGTH
}

function handleUpdate(client: TextSyncClientState, text: string) {
  if (!client.channel) {
    sendJson(client.ws, { type: 'error', message: 'Channel mismatch' })
    return
  }
  if (!isTextWithinLimit(text)) {
    sendJson(client.ws, { type: 'error', message: `Text exceeds ${MAX_TEXT_SYNC_LENGTH} bytes` })
    return
  }
  const state = getOrCreateChannelState(client.channel)
  state.text = text

  const message: TextSyncServerMessage = {
    type: 'sync',
    channel: client.channel,
    text: state.text,
  }
  for (const member of state.clients) {
    sendJson(member.ws, message)
  }
}

function parseClientMessage(raw: string): TextSyncClientMessage | null {
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
  const payload = data as Partial<TextSyncClientMessage>
  if (payload.type !== 'join' && payload.type !== 'update') {
    return null
  }
  if (typeof payload.channel !== 'string' || !textSyncChannelSet.has(payload.channel as TextSyncChannel)) {
    return null
  }
  if (payload.type === 'update' && typeof payload.text !== 'string') {
    return null
  }
  return {
    type: payload.type,
    channel: payload.channel as TextSyncChannel,
    text: payload.text,
  }
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

export function attachTextSyncWsServer(server: HttpServer | HttpsServer) {
  const wsServer = new WebSocketServer({ noServer: true })

  const upgradeHandler = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    if (requestUrl.pathname !== TEXT_SYNC_PATH) {
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
    const client: TextSyncClientState = {
      ws,
      channel: null,
      ip: getRequestIp(request),
    }

    ws.on('message', (raw) => {
      if (typeof raw !== 'string' && !(raw instanceof Buffer)) {
        sendJson(ws, { type: 'error', message: 'Invalid payload type' })
        return
      }
      const payload = parseClientMessage(String(raw))
      if (!payload) {
        sendJson(ws, { type: 'error', message: 'Invalid payload' })
        return
      }
      if (payload.type === 'join') {
        joinChannel(client, payload.channel)
        return
      }
      if (payload.channel !== client.channel || typeof payload.text !== 'string') {
        sendJson(ws, { type: 'error', message: 'Channel mismatch' })
        return
      }
      handleUpdate(client, payload.text)
    })

    ws.on('close', () => {
      if (client.channel) {
        const channel = client.channel
        const state = channelStateMap.get(channel)
        state?.clients.delete(client)
        cleanupChannelIfEmpty(channel)
      }
      consumeIpConnection(client.ip)
    })

    ws.on('error', () => {
      ws.close()
    })

    setTimeout(() => {
      if (ws.readyState === 1 && !client.channel) {
        ws.close()
      }
    }, SAFE_CLOSE_WAIT_MS)
  })

  server.on('upgrade', upgradeHandler)

  return () => {
    server.off('upgrade', upgradeHandler)
    wsServer.close()
    channelStateMap.clear()
    ipConnectionMap.clear()
  }
}
