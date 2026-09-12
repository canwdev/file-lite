<script setup lang="ts">
import type { ITransferItem } from './types'
import { bytesToSize } from '@/utils'

// 单条上传 / 下载行。纯展示：把数据画出来，动作原样抛给父组件。
defineProps<{ item: ITransferItem }>()
defineEmits<{
  cancel: [item: ITransferItem]
  retry: [item: ITransferItem]
  manualDownload: [item: ITransferItem]
}>()
</script>

<template>
  <div
    class="vgo-list-item transfer-item"
    :class="{
      'is-success': item.status === 'success',
      'is-failed': item.status === 'failed',
    }"
  >
    <div class="transfer-item__progress" :style="{ width: `${item.progress * 100}%` }" />

    <div class="item-main">
      <div class="item-status-icon">
        <template v-if="item.status === 'success'">
          <i-mdi-check-circle class="status-success" />
        </template>
        <template v-else-if="item.status === 'failed'">
          <i-mdi-alert-circle class="status-failed" />
        </template>
        <template v-else-if="item.status === 'transferring'">
          <i-mdi-loading class="status-active icon-spin" />
        </template>
        <template v-else>
          <MdiIcon
            class="status-idle"
            :name="item.type === 'download' ? 'download-outline' : 'upload-outline'"
          />
        </template>
      </div>

      <div class="item-content">
        <div class="item-title" :title="item.path">
          <span class="vgo-u-text-overflow">{{ item.filename || item.path }}</span>
        </div>
        <div class="item-meta">
          <template v-if="item.status === 'transferring' && item.speedInfo">
            <span class="speed">{{ bytesToSize(item.speedInfo.rate) }}/s</span>
            <span class="size">{{ bytesToSize(item.speedInfo.loaded) }} / {{ bytesToSize(item.speedInfo.total) }}</span>
          </template>
          <template v-else>
            <span class="message vgo-u-text-overflow" :title="item.message">{{ item.message }}</span>
          </template>
          <span class="percent">{{ (item.progress * 100).toFixed(0) }}%</span>
        </div>
      </div>

      <div class="item-actions">
        <button
          v-if="item.abortObj"
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
          title="Cancel"
          @click="$emit('cancel', item)"
        >
          <i-mdi-close />
        </button>
        <button
          v-if="item.status === 'failed'"
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
          title="Retry"
          @click="$emit('retry', item)"
        >
          <i-mdi-refresh />
        </button>
        <button
          v-if="item.status === 'failed' && item.type === 'download'"
          class="vgo-button vgo-button--primary vgo-button--icon vgo-button--sm"
          title="Manual Download"
          @click="$emit('manualDownload', item)"
        >
          <i-mdi-download />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use './transfer-row.scss';
</style>
