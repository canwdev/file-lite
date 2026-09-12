<script setup lang="ts">
import type { TaskSnapshot } from '@/types/server'
import { isTerminalState } from '@/store/tasks'
import { taskKindIcon, taskMessage, taskProgress, taskTarget, taskTitle } from './server-task-display'

// 单条后台任务行（复制 / 移动 / 删除 / 复制副本）。纯展示，动作抛给父组件。
defineProps<{ task: TaskSnapshot }>()
defineEmits<{
  cancel: [taskId: string]
  resolve: []
  failures: [taskId: string]
  dismiss: [taskId: string]
}>()
</script>

<template>
  <div
    class="vgo-list-item transfer-item server-task-item"
    :class="{
      'is-success': task.state === 'succeeded',
      'is-failed': task.state === 'failed' || task.state === 'partial',
    }"
  >
    <div class="transfer-item__progress" :style="{ width: `${taskProgress(task) * 100}%` }" />

    <div class="item-main">
      <div class="item-status-icon">
        <template v-if="task.state === 'succeeded'">
          <i-mdi-check-circle class="status-success" />
        </template>
        <template v-else-if="task.state === 'failed' || task.state === 'partial'">
          <i-mdi-alert-circle class="status-failed" />
        </template>
        <template v-else-if="task.state === 'awaiting-conflict'">
          <i-mdi-help-circle-outline class="status-warning" />
        </template>
        <template v-else-if="!isTerminalState(task.state)">
          <i-mdi-loading class="status-active icon-spin" />
        </template>
        <template v-else>
          <MdiIcon class="status-idle" :name="taskKindIcon(task.kind)" />
        </template>
      </div>

      <div class="item-content">
        <div class="item-title" :title="taskTarget(task)">
          <span class="vgo-u-text-overflow">{{ taskTitle(task) }}</span>
        </div>
        <div class="item-meta">
          <span class="message vgo-u-text-overflow" :title="taskMessage(task)">{{ taskMessage(task) }}</span>
          <span class="percent">{{ (taskProgress(task) * 100).toFixed(0) }}%</span>
        </div>
      </div>

      <div class="item-actions">
        <button
          v-if="task.state === 'awaiting-conflict'"
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
          title="Resolve conflict"
          @click="$emit('resolve')"
        >
          <i-mdi-help-circle-outline />
        </button>
        <button
          v-if="task.canCancel"
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
          title="Cancel"
          @click="$emit('cancel', task.id)"
        >
          <i-mdi-close />
        </button>
        <button
          v-if="isTerminalState(task.state) && (task.stats.failed + task.stats.conflict) > 0"
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
          :title="`${task.stats.failed + task.stats.conflict} item(s) failed — show details`"
          @click="$emit('failures', task.id)"
        >
          <i-mdi-alert-circle class="status-failed" />
        </button>
        <button
          v-if="isTerminalState(task.state)"
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
          title="Remove from list"
          @click="$emit('dismiss', task.id)"
        >
          <i-mdi-close />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use './transfer-row.scss';
</style>
