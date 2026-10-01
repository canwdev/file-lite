import type { SharedWsClientMessage, SharedWsServerMessage } from '@/types/server'
import { authSession } from '@/store/auth'

const SHARED_WS_ENDPOINT = '/api/ws'
const RECONNECT_DELAY_MS = 2000
const LOG_PREFIX = '[SharedWs]'

type SharedWsListener = (message: SharedWsServerMessage) => void

export const sharedWsConnected = ref(false)
export type SharedWsStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
export const sharedWsStatus = ref<SharedWsStatus>('disconnected')

const listeners = new Set<SharedWsListener>()

let sharedWs: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let connectPromise: Promise<WebSocket> | null = null
let shouldReconnect = true

function buildSharedWsUrl(): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${window.location.host}${SHARED_WS_ENDPOINT}`
}

function scheduleReconnect() {
  if (!shouldReconnect || reconnectTimer || !authSession.value) {
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
      emitMessage(message)
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
    if (shouldReconnect && authSession.value) {
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

  if (!authSession.value) {
    console.warn(`${LOG_PREFIX} connect aborted: no session`)
    throw new Error('No session')
  }

  shouldReconnect = true
  sharedWsStatus.value = 'connecting'
  console.log(`${LOG_PREFIX} connecting to ${buildSharedWsUrl()}`)
  connectPromise = new Promise<WebSocket>((resolve, reject) => {
    // The HttpOnly auth cookie rides along on the same-origin handshake, so the
    // token never appears in a URL.
    const ws = new WebSocket(buildSharedWsUrl())
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
  if (sharedWs) {
    console.log(`${LOG_PREFIX} closed intentionally`)
    sharedWs.close()
  }
  sharedWs = null
}

/**
 * 发送一条实时协作消息（text-sync）。
 *
 * 命令不再走这里：任务、设置、属性都是 HTTP 请求，这条连接只负责推送与 text-sync。
 */
export async function sendSharedWsMessage(payload: SharedWsClientMessage) {
  const ws = await ensureSharedWsConnected()
  ws.send(JSON.stringify(payload))
}

export function subscribeSharedWsMessage(listener: SharedWsListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
