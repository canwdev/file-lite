<script lang="ts" setup>
import type { TextSyncChannel, TextSyncClientMessage, TextSyncServerMessage } from '@/types/server'
import { useDebounceFn } from '@vueuse/core'
import { API_PROXY_BASE } from '@/enum'
import { authToken } from '@/store'
import { TEXT_SYNC_CHANNELS } from '@/types/server'

const activeChannel = ref<TextSyncChannel>('CH1')
const textContent = ref('')
const isConnected = ref(false)

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let shouldReconnect = true
let applyingRemoteText = false

function buildTextSyncWsUrl(): string {
  const endpoint = '/api/files/text-sync'
  const base = API_PROXY_BASE || ''
  if (base.startsWith('http://') || base.startsWith('https://')) {
    const wsBase = base.replace(/^http/i, 'ws').replace(/\/$/, '')
    return `${wsBase}${endpoint}`
  }
  const pathBase = base ? `/${base.replace(/^\/+/, '').replace(/\/$/, '')}` : ''
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${window.location.host}${pathBase}${endpoint}`
}

function sendMessage(payload: TextSyncClientMessage) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return
  }
  ws.send(JSON.stringify(payload))
}

const sendTextUpdate = useDebounceFn((text: string) => {
  sendMessage({
    type: 'update',
    channel: activeChannel.value,
    text,
  })
}, 120)

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }
  const url = new URL(buildTextSyncWsUrl())
  if (authToken.value) {
    url.searchParams.set('token', authToken.value)
  }
  ws = new WebSocket(url)

  ws.onopen = () => {
    isConnected.value = true
    sendMessage({
      type: 'join',
      channel: activeChannel.value,
    })
  }

  ws.onmessage = (event) => {
    let message: TextSyncServerMessage | null = null
    try {
      message = JSON.parse(String(event.data)) as TextSyncServerMessage
    }
    catch {
      return
    }
    if (!message || message.type === 'error') {
      if (message?.type === 'error') {
        window.$message.error(message.message)
      }
      return
    }
    if (message.type !== 'sync' || message.channel !== activeChannel.value) {
      return
    }
    applyingRemoteText = true
    textContent.value = message.text
    setTimeout(() => {
      applyingRemoteText = false
    }, 0)
  }

  ws.onclose = () => {
    isConnected.value = false
    ws = null
    if (!shouldReconnect) {
      return
    }
    reconnectTimer = setTimeout(connect, 1000)
  }

  ws.onerror = () => {
    isConnected.value = false
  }
}

watch(activeChannel, () => {
  sendMessage({
    type: 'join',
    channel: activeChannel.value,
  })
})

watch(textContent, (value) => {
  if (applyingRemoteText) {
    return
  }
  sendTextUpdate(value)
})

async function copyText() {
  try {
    await navigator.clipboard.writeText(textContent.value)
    window.$message.success('Copied')
  }
  catch {
    window.$message.error('Copy failed')
  }
}

async function pasteText() {
  try {
    const value = await navigator.clipboard.readText()
    textContent.value = value
  }
  catch {
    window.$message.error('Paste failed')
  }
}

onMounted(() => {
  connect()
})

onBeforeUnmount(() => {
  shouldReconnect = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  ws?.close()
  ws = null
})
</script>

<template>
  <div class="text-sync-wrap">
    <div class="text-sync-channels">
      <button
        v-for="channel in TEXT_SYNC_CHANNELS"
        :key="channel"
        type="button"
        class="vgo-button channel-btn"
        :class="{ active: channel === activeChannel }"
        @click="activeChannel = channel"
      >
        {{ channel }}
      </button>
      <span class="conn-state" :class="{ connected: isConnected }">
        {{ isConnected ? 'Connected' : 'Disconnected' }}
      </span>
    </div>

    <div class="text-sync-actions">
      <button type="button" class="vgo-button" @click="copyText">
        Copy
      </button>
      <button type="button" class="vgo-button" @click="pasteText">
        Paste
      </button>
    </div>

    <textarea
      v-model="textContent"
      class="vgo-input text-sync-textarea"
      spellcheck="false"
      placeholder="Type text here, sync in real time..."
    />
  </div>
</template>

<style scoped lang="scss">
.text-sync-wrap {
  height: 100%;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.text-sync-channels {
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--vgo-color-border, #ddd);
  padding-bottom: 8px;
}

.channel-btn {
  min-width: 56px;
}

.channel-btn.active {
  border-color: var(--vgo-primary, #409eff);
  color: var(--vgo-primary, #409eff);
}

.conn-state {
  margin-left: auto;
  font-size: 12px;
  opacity: 0.75;
}

.conn-state.connected {
  color: var(--vgo-color-success, #67c23a);
  opacity: 1;
}

.text-sync-actions {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--vgo-color-border, #ddd);
  padding-bottom: 8px;
}

.text-sync-textarea {
  width: 100%;
  flex: 1;
  resize: none;
  min-height: 220px;
}
</style>
