import type { SettingsClientMessage, SharedWsClientMessage, SharedWsServerMessage } from '@/types/server'
import Cookies from 'js-cookie'

const AUTH_TOKEN_COOKIE_KEY = 'file_lite_auth_token'
const SHARED_WS_ENDPOINT = '/api/ws'
const RECONNECT_DELAY_MS = 2000
const REQUEST_TIMEOUT_MS = 10000
const LOG_PREFIX = '[SharedWs]'

type SharedWsListener = (message: SharedWsServerMessage) => void

interface PendingRequest {
  resolve: (message: SharedWsServerMessage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export const sharedWsConnected = ref(false)
export type SharedWsStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
export const sharedWsStatus = ref<SharedWsStatus>('disconnected')

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
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${window.location.host}${SHARED_WS_ENDPOINT}`
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
  sharedWsStatus.value = 'reconnecting'
  console.log(`${LOG_PREFIX} reconnect scheduled in ${RECONNECT_DELAY_MS}ms`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    console.log(`${LOG_PREFIX} reconnecting`)
    sharedWsStatus.value = 'connecting'
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
    sharedWsStatus.value = 'connected'
    console.log(`${LOG_PREFIX} connected`)
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

  ws.onclose = (event) => {
    sharedWsConnected.value = false
    console.log(`${LOG_PREFIX} disconnected (code=${event.code}${event.reason ? `, reason=${event.reason}` : ''})`)
    if (sharedWs === ws) {
      sharedWs = null
    }
    connectPromise = null
    clearPendingRequests(new Error('WebSocket disconnected'))
    if (shouldReconnect && getToken()) {
      scheduleReconnect()
    }
    else {
      sharedWsStatus.value = 'disconnected'
    }
  }

  ws.onerror = () => {
    sharedWsConnected.value = false
    sharedWsStatus.value = 'disconnected'
    console.warn(`${LOG_PREFIX} connection error`)
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
    console.log(`${LOG_PREFIX} waiting for in-flight connection`)
    return await connectPromise
  }

  const token = getToken()
  if (!token) {
    console.warn(`${LOG_PREFIX} connect aborted: no auth token`)
    throw new Error('No auth token')
  }

  shouldReconnect = true
  sharedWsStatus.value = 'connecting'
  console.log(`${LOG_PREFIX} connecting to ${buildSharedWsUrl()}`)
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
  sharedWsStatus.value = 'disconnected'
  clearPendingRequests(new Error('WebSocket closed'))
  if (sharedWs) {
    console.log(`${LOG_PREFIX} closed intentionally`)
    sharedWs.close()
  }
  sharedWs = null
}

export function setSharedWsToken(token: string) {
  const prevToken = currentToken
  currentToken = token
  if (!token) {
    console.log(`${LOG_PREFIX} token cleared`)
    closeSharedWs()
    return
  }
  shouldReconnect = true
  if (prevToken && prevToken !== token) {
    console.log(`${LOG_PREFIX} token changed, reconnecting`)
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
