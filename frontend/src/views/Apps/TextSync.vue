<script lang="ts" setup>
import type { SharedWsServerMessage, TextSyncChannel, TextSyncClientMessage } from '@/types/server'
import { useDebounceFn } from '@vueuse/core'
import { ensureSharedWsConnected, sendSharedWsMessage, sharedWsConnected, subscribeSharedWsMessage } from '@/api/shared-ws'
import { TEXT_SYNC_CHANNELS } from '@/types/server'

const activeChannel = ref<TextSyncChannel>('CH1')
const textContent = ref('')

let applyingRemoteText = false
let stopSharedWsSubscription: (() => void) | null = null

const isConnected = computed(() => sharedWsConnected.value)

async function sendMessage(payload: TextSyncClientMessage) {
  await sendSharedWsMessage(payload)
}

const sendTextUpdate = useDebounceFn((text: string) => {
  void sendMessage({
    scope: 'text-sync',
    type: 'update',
    channel: activeChannel.value,
    text,
  })
}, 120)

function applyRemoteText(text: string) {
  applyingRemoteText = true
  textContent.value = text
  setTimeout(() => {
    applyingRemoteText = false
  }, 0)
}

async function ensureTextSyncConnected() {
  try {
    await ensureSharedWsConnected()
  }
  catch (error) {
    console.error(error)
  }
}

function handleSharedWsMessage(message: SharedWsServerMessage) {
  if (message.scope === 'text-sync' && message.type === 'sync') {
    if (message.channel !== activeChannel.value) {
      return
    }
    applyRemoteText(message.text)
    return
  }
  if (message.scope === 'text-sync' && message.type === 'error') {
    window.$message.error(message.message)
  }
}

watch(activeChannel, () => {
  if (!sharedWsConnected.value) {
    return
  }
  void sendMessage({
    scope: 'text-sync',
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

watch(
  sharedWsConnected,
  (value) => {
    if (!value) {
      return
    }
    void sendMessage({
      scope: 'text-sync',
      type: 'join',
      channel: activeChannel.value,
    })
  },
  { immediate: true },
)

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

function clearText() {
  textContent.value = ''
}

onMounted(() => {
  stopSharedWsSubscription = subscribeSharedWsMessage(handleSharedWsMessage)
  void ensureTextSyncConnected()
})

onBeforeUnmount(() => {
  stopSharedWsSubscription?.()
  stopSharedWsSubscription = null
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
      <button type="button" class="vgo-button mdi mdi-content-copy" @click="copyText">
        Copy
      </button>
      <button type="button" class="vgo-button mdi mdi-content-paste" @click="pasteText">
        Paste
      </button>
      <button type="button" class="vgo-button mdi mdi-delete-sweep danger" @click="clearText">
        Clear
      </button>
    </div>

    <textarea
      v-model="textContent"
      class="vgo-input text-sync-textarea"
      spellcheck="false"
      :placeholder="`[${activeChannel}] Type text here, sync in real time...`"
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
