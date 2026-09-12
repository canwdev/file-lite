<script setup lang="ts">
import type { StatusBadge } from './status-badge'

/**
 * 传输 / 任务行左侧的图标：大图标是任务类型，右下角小角标才是状态。
 * 上传、下载、后台任务共用这套规则。
 */
defineProps<{
  /** 主图标名，走 mdiIconRegistry，必须已注册 */
  icon: string
  /** 状态角标；为空表示还没有状态可报（例如排队中） */
  badge?: StatusBadge | null
}>()
</script>

<template>
  <div class="status-icon">
    <MdiIcon class="status-icon__main" :name="icon" />

    <span
      v-if="badge"
      class="status-icon__badge"
      :class="`is-${badge}`"
    >
      <i-mdi-loading v-if="badge === 'active'" class="icon-spin" />
      <i-mdi-pause-circle v-else-if="badge === 'paused'" />
      <i-mdi-check-circle v-else-if="badge === 'success'" />
      <i-mdi-alert-circle v-else-if="badge === 'failed'" />
    </span>
  </div>
</template>

<style scoped lang="scss">
.status-icon {
  position: relative;
  display: flex;
  flex: 0 0 var(--vgo-icon-lg);
  align-items: center;
  justify-content: center;
  font-size: var(--vgo-icon-md);

  &__main {
    color: var(--vgo-text-secondary);
  }

  // 角标压在图标右下角：主图标始终是任务类型，状态不抢它的位置。
  // 底色用面板表面色，让角标从主图标的线条里跳出来。
  &__badge {
    position: absolute;
    right: -4px;
    bottom: -6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--vgo-icon-sm);
    line-height: 1;
    background-color: var(--vgo-surface-raised);
    border-radius: var(--vgo-radius-pill);

    &.is-active { color: var(--vgo-primary); }
    &.is-paused { color: var(--vgo-warning); }
    &.is-success { color: var(--vgo-success); }
    &.is-failed { color: var(--vgo-danger); }
  }
}
</style>
