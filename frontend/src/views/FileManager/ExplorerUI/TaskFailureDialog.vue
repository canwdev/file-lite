<script setup lang="ts">
import type { TaskItemResult } from '@/types/server'
import { computed, ref } from 'vue'
import {
  closeFailureDialog,
  failedItemsOf,
  failureDialogTaskId,
  retryTask,
  taskList,
} from '@/store/tasks'

const isRetrying = ref(false)

const task = computed(() => taskList.value.find(item => item.id === failureDialogTaskId.value) ?? null)
const items = computed(() => (failureDialogTaskId.value ? failedItemsOf(failureDialogTaskId.value) : []))

const visible = computed({
  get: () => failureDialogTaskId.value !== null,
  set: (value: boolean) => {
    if (!value) {
      closeFailureDialog()
    }
  },
})

/** 失败 + 冲突的真实总数（列表可能被服务端截断到 200 条）。 */
const totalFailed = computed(() => (task.value ? task.value.stats.failed + task.value.stats.conflict : 0))
const truncated = computed(() => Boolean(task.value?.resultsTruncated) && items.value.length < totalFailed.value)

function itemLabel(item: TaskItemResult) {
  const segments = item.fromPath.split('/').filter(Boolean)
  return segments[segments.length - 1] || item.fromPath
}

function itemMessage(item: TaskItemResult) {
  if (item.message) {
    return item.message
  }
  return item.status === 'conflict'
    ? 'A conflicting item appeared at the destination'
    : 'Failed'
}

async function handleRetry() {
  if (!failureDialogTaskId.value) {
    return
  }
  isRetrying.value = true
  try {
    await retryTask(failureDialogTaskId.value)
    closeFailureDialog()
  }
  catch (error: any) {
    window.$message?.error(error?.message || 'Nothing to retry')
  }
  finally {
    isRetrying.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="failure-dialog"
    width="520px"
    append-to-body
    :close-on-click-modal="false"
  >
    <template #header>
      <div class="failure-header">
        <i-mdi-alert-circle class="failure-icon" />
        <span>{{ totalFailed }} item(s) failed</span>
      </div>
    </template>

    <div v-if="task" class="failure-body">
      <div class="failure-summary">
        <span v-if="task.toPath">Destination: {{ task.toPath }}</span>
        <span v-if="task.stats.succeeded"> · {{ task.stats.succeeded }} succeeded</span>
        <span v-if="task.stats.skipped"> · {{ task.stats.skipped }} skipped</span>
      </div>

      <div class="failure-list vgo-u-scrollbar">
        <div
          v-for="(item, index) in items"
          :key="item.fromPath + index"
          class="vgo-list-item failure-item"
        >
          <MdiIcon
            class="failure-item-icon"
            :name="item.status === 'conflict' ? 'help-circle-outline' : 'alert-circle-outline'"
          />
          <span class="failure-item-name vgo-u-text-overflow" :title="item.fromPath">
            {{ itemLabel(item) }}
          </span>
          <span class="failure-item-message vgo-u-text-overflow" :title="itemMessage(item)">
            {{ itemMessage(item) }}
          </span>
        </div>
        <div v-if="truncated" class="failure-truncated">
          Showing the first {{ items.length }} of {{ totalFailed }} failures. Try Again retries them all.
        </div>
      </div>
    </div>

    <template #footer>
      <div class="failure-footer">
        <button class="vgo-button" @click="closeFailureDialog">
          Close
        </button>
        <button class="vgo-button vgo-button--primary" :disabled="isRetrying || !items.length" @click="handleRetry">
          {{ isRetrying ? 'Retrying...' : 'Try Again' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
.failure-header {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
  font-size: var(--vgo-font-lg);

  .failure-icon {
    color: var(--vgo-danger);
  }
}

.failure-body {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-2);
  font-size: var(--vgo-font-md);

  .failure-summary {
    color: var(--vgo-text-secondary);
    font-size: var(--vgo-font-sm);
  }

  .failure-list {
    max-height: 260px;
    overflow: auto;
    border: 1px solid var(--vgo-border);
    border-radius: var(--vgo-radius);
    padding: var(--vgo-space-1);
  }

  .failure-item {
    gap: var(--vgo-space-2);
    padding: var(--vgo-space-1) var(--vgo-space-2);
    font-size: var(--vgo-font-sm);

    .failure-item-icon {
      flex-shrink: 0;
      color: var(--vgo-danger);
    }

    .failure-item-name {
      flex: 0 1 auto;
      max-width: 45%;
      font-weight: 500;
    }

    .failure-item-message {
      flex: 1;
      min-width: 0;
      color: var(--vgo-text-secondary);
    }
  }

  .failure-truncated {
    padding: var(--vgo-space-1) var(--vgo-space-2);
    color: var(--vgo-text-secondary);
    font-size: var(--vgo-font-sm);
  }
}

.failure-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--vgo-space-1);
}
</style>
