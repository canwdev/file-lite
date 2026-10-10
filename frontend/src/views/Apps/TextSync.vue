<script lang="ts" setup>
import type { SharedWsServerMessage, TextSyncChannel, TextSyncClientMessage } from '@/types/server'
import { useDebounceFn } from '@vueuse/core'
import { ensureSharedWsConnected, sendSharedWsMessage, sharedWsConnected, subscribeSharedWsMessage } from '@/api/shared-ws'
import { TEXT_SYNC_CHANNELS } from '@/types/server'

const activeChannel = ref<TextSyncChannel>('CH1')
const textContent = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

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
  catch (error) {
    console.error('[pasteText]', error)
    window.$message.error(`Paste failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

function clearText() {
  textContent.value = ''
}

/**
 * 打开就可以直接打字：把光标放进输入框。
 *
 * 窗口根节点是 `v-show` 的，而它要到 ViewPortWindow 的 onMounted 里才真正显示
 * （子组件的 onMounted 先跑），所以挂载时直接 focus 会落在 `display: none` 上、不生效。
 * 等这一轮 DOM 刷完（父组件已把它显示出来）再聚焦；窗口管理器随后把焦点放到内容容器时，
 * focusContent 会因为「焦点已在窗口内」而跳过，不会抢走。
 */
async function focusTextarea(): Promise<void> {
  await nextTick()
  textareaRef.value?.focus({ preventScroll: true })
}

onMounted(() => {
  stopSharedWsSubscription = subscribeSharedWsMessage(handleSharedWsMessage)
  void ensureTextSyncConnected()
  void focusTextarea()
})

onBeforeUnmount(() => {
  stopSharedWsSubscription?.()
  stopSharedWsSubscription = null
})
</script>

<template>
  <div class="text-sync-wrap">
    <div class="text-sync-channels">
      <div class="vgo-rect-switch">
        <button
          v-for="channel in TEXT_SYNC_CHANNELS"
          :key="channel"
          type="button"
          class="vgo-u-button-reset vgo-rect-switch__item"
          :class="{ 'is-active': channel === activeChannel }"
          @click="activeChannel = channel"
        >
          {{ channel }}
        </button>
      </div>
      <span class="conn-state" :class="{ connected: isConnected }">
        {{ isConnected ? 'Connected' : 'Disconnected' }}
      </span>
    </div>

    <div class="text-sync-actions">
      <div class="vgo-button-group">
        <button type="button" class="vgo-button" @click="copyText">
          <i-mdi-content-copy /> Copy
        </button>
        <button type="button" class="vgo-button" @click="pasteText">
          <i-mdi-content-paste /> Paste
        </button>
        <button type="button" class="vgo-button vgo-button--danger" @click="clearText">
          <i-mdi-delete-sweep /> Clear
        </button>
      </div>
    </div>

    <textarea
      ref="textareaRef"
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
  padding: var(--vgo-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-3);
}

.text-sync-channels {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);

  .vgo-rect-switch__item {
    min-width: 56px;
  }
}

.conn-state {
  margin-left: auto;
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
}

.conn-state.connected {
  color: var(--vgo-success);
}

.text-sync-actions {
  display: flex;
  gap: var(--vgo-space-2);

  // 图标与按钮文字等大：迁移前 mdi 类直接挂在按钮本身上（非 vgo 内置 .mdi 后代规则作用范围），
  // 字形随按钮字号；转为内联 SVG 后需显式豁免全局的按钮图标 md/lg 尺寸规则
  svg {
    font-size: inherit;
  }
}

.text-sync-textarea {
  width: 100%;
  flex: 1;
  resize: none;
  min-height: 220px;
}
</style>
