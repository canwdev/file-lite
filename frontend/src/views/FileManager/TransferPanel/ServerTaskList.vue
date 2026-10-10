<script setup lang="ts">
import type { TaskSnapshot } from '@/types/server'
import ServerTaskRow from './ServerTaskRow.vue'

// 后台任务列表（复制 / 移动 / 删除 / 复制副本）。数量少，不做虚拟滚动。
defineProps<{ tasks: TaskSnapshot[] }>()
defineEmits<{
  cancel: [taskId: string]
  failures: [taskId: string]
  dismiss: [taskId: string]
}>()
</script>

<template>
  <div class="server-task-list vgo-u-scrollbar">
    <div v-if="!tasks.length" class="vgo-empty server-task-list__empty">
      <MdiIcon class="vgo-empty__icon" name="folder-move-outline" />
      <div class="vgo-empty__title">
        {{ $t('file_lite_i18n.no_transfers') }}
      </div>
      <div class="vgo-empty__desc">
        {{ $t('file_lite_i18n.transfers_hint') }}
      </div>
    </div>
    <ServerTaskRow
      v-for="task in tasks"
      v-else
      :key="task.id"
      :task="task"
      @cancel="$emit('cancel', $event)"
      @failures="$emit('failures', $event)"
      @dismiss="$emit('dismiss', $event)"
    />
  </div>
</template>

<style scoped lang="scss">
.server-task-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;

  &__empty {
    height: 100%;
  }
}
</style>
