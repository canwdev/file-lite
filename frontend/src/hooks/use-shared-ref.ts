import type { Ref } from 'vue'
import { nextTick, ref, toRaw, watch } from 'vue'

interface SharedRefOptions {
  channelName?: string
}

type SharedRefMessage<T>
  = | { type: 'request', key: string, source: string }
    | { type: 'response', key: string, source: string, target: string, value: T }
    | { type: 'update', key: string, source: string, value: T }

interface SharedRefEntry<T> {
  state: Ref<T>
}

const DEFAULT_CHANNEL_NAME = 'file-lite:shared-ref'
const sourceId = createSourceId()
const sharedRefMap = new Map<string, SharedRefEntry<unknown>>()

// 在多个窗口之间共享状态
export function useSharedRef<T>(
  key: string,
  initialValue: T,
  options: SharedRefOptions = {},
): Ref<T> {
  const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME
  const cacheKey = `${channelName}:${key}`
  const cached = sharedRefMap.get(cacheKey) as SharedRefEntry<T> | undefined
  if (cached) {
    return cached.state
  }

  const state = ref(cloneValue(initialValue)) as Ref<T>
  const entry: SharedRefEntry<T> = { state }
  sharedRefMap.set(cacheKey, entry as SharedRefEntry<unknown>)

  if (typeof BroadcastChannel === 'undefined') {
    return state
  }

  const channel = new BroadcastChannel(channelName)
  let applyingRemoteValue = false

  channel.onmessage = (event: MessageEvent<SharedRefMessage<T>>) => {
    const message = event.data
    if (!message || message.key !== key || message.source === sourceId) {
      return
    }

    if (message.type === 'request') {
      postMessage(channel, {
        type: 'response',
        key,
        source: sourceId,
        target: message.source,
        value: state.value,
      })
      return
    }

    if (message.type === 'response' && message.target !== sourceId) {
      return
    }

    applyingRemoteValue = true
    state.value = cloneValue(message.value)
    nextTick(() => {
      applyingRemoteValue = false
    })
  }

  watch(
    state,
    (value) => {
      if (applyingRemoteValue) {
        return
      }
      postMessage(channel, {
        type: 'update',
        key,
        source: sourceId,
        value,
      })
    },
    { deep: true },
  )

  postMessage(channel, {
    type: 'request',
    key,
    source: sourceId,
  })

  return state
}

function postMessage<T>(channel: BroadcastChannel, message: SharedRefMessage<T>) {
  try {
    channel.postMessage(cloneValue(message))
  }
  catch (error) {
    console.warn('[useSharedRef] Failed to broadcast shared state.', error)
  }
}

function cloneValue<T>(value: T): T {
  const rawValue = toRaw(value)
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(rawValue)
    }
    catch {
      // Vue reactive proxies cannot be cloned by structuredClone directly.
    }
  }

  try {
    return JSON.parse(JSON.stringify(rawValue)) as T
  }
  catch {
    return rawValue
  }
}

function createSourceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
