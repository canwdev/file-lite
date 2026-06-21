import type { SettingsClientMessage, SharedWsClientMessage, SharedWsServerMessage } from '@/types/server'
import Cookies from 'js-cookie'
import { API_PROXY_BASE } from '@/enum'

const AUTH_TOKEN_COOKIE_KEY = 'file_lite_auth_token'
const SHARED_WS_ENDPOINT = '/api/ws'
const RECONNECT_DELAY_MS = 1000
const REQUEST_TIMEOUT_MS = 10000

type SharedWsListener = (message: SharedWsServerMessage) => void

interface PendingRequest {
  resolve: (message: SharedWsServerMessage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export const sharedWsConnected = ref(false)

const listeners = new Set<SharedWsListener>()
const pendingRequests = new Map<string, PendingRequest>()

let sharedWs: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let connectPromise: Promise<WebSocket> | null = null
let shouldReconnect = true
let currentToken = ''
let requestSequence = 0

function getToken() {
  return currentToken || Cookies.get(AUTH_TOKEN_COOKIE_KEY) || ''
}

function buildSharedWsUrl(): string {
  const base = API_PROXY_BASE || ''
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${base.replace(/^http/i, 'ws').replace(/\/$/, '')}${SHARED_WS_ENDPOINT}`
  }
  const pathBase = base ? `/${base.replace(/^\/+/, '').replace(/\/$/, '')}` : ''
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${window.location.host}${pathBase}${SHARED_WS_ENDPOINT}`
}

function clearPendingRequests(error: Error) {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  pendingRequests.clear()
}

function scheduleReconnect() {
  if (!shouldReconnect || reconnectTimer || !getToken()) {
    return
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void ensureSharedWsConnected().catch(() => {})
  }, RECONNECT_DELAY_MS)
}

function emitMessage(message: SharedWsServerMessage) {
  for (const listener of listeners) {
    listener(message)
  }
}

function handleServerMessage(message: SharedWsServerMessage) {
  if ('requestId' in message && typeof message.requestId === 'string') {
    const pending = pendingRequests.get(message.requestId)
    if (pending && (message.type === 'response' || message.type === 'error')) {
      clearTimeout(pending.timer)
      pendingRequests.delete(message.requestId)
      if (message.type === 'error') {
        pending.reject(new Error(message.message))
      }
      else {
        pending.resolve(message)
      }
      return
    }
  }
  emitMessage(message)
}

function bindSharedWs(ws: WebSocket, resolve: (ws: WebSocket) => void, reject: (error: Error) => void) {
  ws.onopen = () => {
    sharedWsConnected.value = true
    resolve(ws)
  }

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as SharedWsServerMessage
      handleServerMessage(message)
    }
    catch {
      // ignore invalid payload
    }
  }

  ws.onclose = () => {
    sharedWsConnected.value = false
    if (sharedWs === ws) {
      sharedWs = null
    }
    connectPromise = null
    clearPendingRequests(new Error('WebSocket disconnected'))
    scheduleReconnect()
  }

  ws.onerror = () => {
    sharedWsConnected.value = false
    if (connectPromise) {
      reject(new Error('WebSocket connection failed'))
    }
    ws.close()
  }
}

export async function ensureSharedWsConnected(): Promise<WebSocket> {
  if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
    return sharedWs
  }
  if (connectPromise) {
    return await connectPromise
  }

  const token = getToken()
  if (!token) {
    throw new Error('No auth token')
  }

  shouldReconnect = true
  connectPromise = new Promise<WebSocket>((resolve, reject) => {
    const url = new URL(buildSharedWsUrl())
    url.searchParams.set('token', token)

    const ws = new WebSocket(url)
    sharedWs = ws
    bindSharedWs(ws, resolve, reject)
  })

  return await connectPromise
}

export function closeSharedWs() {
  shouldReconnect = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  connectPromise = null
  sharedWsConnected.value = false
  clearPendingRequests(new Error('WebSocket closed'))
  sharedWs?.close()
  sharedWs = null
}

export function setSharedWsToken(token: string) {
  const prevToken = currentToken
  currentToken = token
  if (!token) {
    closeSharedWs()
    return
  }
  shouldReconnect = true
  if (prevToken && prevToken !== token) {
    sharedWs?.close()
  }
}

export async function sendSharedWsMessage(payload: SharedWsClientMessage) {
  const ws = await ensureSharedWsConnected()
  ws.send(JSON.stringify(payload))
}

export async function requestSharedWs<T extends SharedWsServerMessage>(
  payload:
    | Omit<Extract<SettingsClientMessage, { type: 'get' }>, 'requestId'>
    | Omit<Extract<SettingsClientMessage, { type: 'set' }>, 'requestId'>
    | Omit<Extract<SettingsClientMessage, { type: 'delete' }>, 'requestId'>,
): Promise<T> {
  const requestId = `req_${Date.now()}_${requestSequence++}`
  const message = {
    ...payload,
    requestId,
  } as Extract<SharedWsClientMessage, { scope: 'settings' }>

  await ensureSharedWsConnected()

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('WebSocket request timeout'))
    }, REQUEST_TIMEOUT_MS)

    pendingRequests.set(requestId, {
      resolve: message => resolve(message as T),
      reject,
      timer,
    })

    sharedWs?.send(JSON.stringify(message))
  })
}

export function subscribeSharedWsMessage(listener: SharedWsListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
