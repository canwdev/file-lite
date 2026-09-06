<script lang="ts" setup>
import { sharedWsStatus } from '@/api/shared-ws'
import { authToken } from '@/store/auth'

const statusText = computed(() => {
  switch (sharedWsStatus.value) {
    case 'connecting':
      return 'WS Connecting...'
    case 'reconnecting':
      return 'WS Reconnecting...'
    case 'disconnected':
      return 'WS Disconnected'
    default:
      return ''
  }
})

const visible = computed(() => !!authToken.value && sharedWsStatus.value !== 'connected')
</script>

<template>
  <transition name="fade">
    <div v-if="visible" class="ws-status-display vgo-panel">
      <i-mdi-wifi />
      {{ statusText }}
    </div>
  </transition>
</template>

<style lang="scss" scoped>
.ws-status-display {
  position: fixed;
  left: 50%;
  bottom: var(--vgo-space-2);
  z-index: var(--vgo-z-preview);
  transform: translateX(-50%);
  padding: var(--vgo-space-1) var(--vgo-space-3);
  font-size: var(--vgo-font-md);
}
</style>
