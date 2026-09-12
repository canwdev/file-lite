<script setup lang="ts">
import { bytesToSize } from '@/utils'
import { useConflictDialog } from './conflict-dialog'

const {
  visible,
  request,
  current,
  step,
  conflictTotal,
  multiple,
  stepping,
  policy,
  applyToAll,
  destLabel,
  actionLabel,
  conflictSummary,
  replaceLabel,
  skipLabel,
  keepBothLabel,
  submit,
  close,
} = useConflictDialog()

function itemSize(isDirectory: boolean, size?: number) {
  if (isDirectory) {
    return 'Folder'
  }
  return typeof size === 'number' ? bytesToSize(size) : ''
}

function formatTime(ms?: number) {
  if (!ms) {
    return ''
  }
  return new Date(ms).toLocaleString()
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="conflict-dialog"
    width="480px"
    append-to-body
    :close-on-click-modal="false"
    :show-close="false"
    @closed="close"
  >
    <template #header>
      <div class="conflict-header">
        <i-mdi-alert-outline class="conflict-icon" />
        <span>Replace or Skip Files</span>
      </div>
    </template>

    <div v-if="request" class="conflict-body">
      <div class="conflict-summary">
        {{ conflictSummary }}
        <span v-if="destLabel"> in "{{ destLabel }}"</span>
      </div>
      <div v-if="stepping" class="conflict-step">
        {{ actionLabel }} {{ step + 1 }} of {{ conflictTotal }}
      </div>

      <div class="conflict-list vgo-u-scrollbar">
        <div
          v-for="(item, index) in request.conflicts"
          :key="item.relativePath + index"
          class="vgo-list-item conflict-item"
          :class="{ 'is-active': stepping && index === step }"
        >
          <MdiIcon :name="item.sourceIsDirectory ? 'folder' : 'file-outline'" class="conflict-item-icon" />
          <span class="conflict-item-name vgo-u-text-overflow" :title="item.relativePath">
            {{ item.relativePath }}
          </span>
          <span class="conflict-item-size">{{ itemSize(item.sourceIsDirectory, item.sourceSize) }}</span>
        </div>
        <div v-if="request.truncated" class="conflict-truncated">
          Showing the first {{ request.conflicts.length }} of {{ request.totalCount }} conflicts.
        </div>
      </div>

      <div v-if="current && current.kind !== 'file-vs-file'" class="conflict-warning">
        The destination already contains a {{ current.destIsDirectory ? 'folder' : 'file' }} with the same name.
        Replacing will delete it (folders are deleted with their contents).
      </div>

      <el-radio-group v-model="policy" class="conflict-options">
        <el-radio value="overwrite">
          {{ replaceLabel }}
        </el-radio>
        <el-radio value="skip">
          {{ skipLabel }}
        </el-radio>
        <el-radio value="keep-both">
          {{ keepBothLabel }}
        </el-radio>
      </el-radio-group>

      <el-checkbox v-if="multiple" v-model="applyToAll" class="conflict-apply-all">
        Do this for all {{ conflictTotal }} conflicts
      </el-checkbox>

      <div v-if="stepping && current" class="conflict-compare">
        <div>
          <span class="compare-label">Incoming:</span>
          {{ itemSize(current.sourceIsDirectory, current.sourceSize) }}
          <template v-if="current.sourceMtime">
            · {{ formatTime(current.sourceMtime) }}
          </template>
        </div>
        <div>
          <span class="compare-label">Existing:</span>
          {{ itemSize(current.destIsDirectory, current.destSize) }}
          <template v-if="current.destMtime">
            · {{ formatTime(current.destMtime) }}
          </template>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="conflict-footer">
        <button class="vgo-button" @click="close">
          Cancel
        </button>
        <button class="vgo-button vgo-button--primary" @click="submit">
          {{ stepping && step < conflictTotal - 1 ? 'Next' : 'Continue' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
.conflict-header {
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
  font-size: var(--vgo-font-lg);

  .conflict-icon {
    color: var(--vgo-warning);
  }
}

.conflict-body {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-2);
  font-size: var(--vgo-font-md);

  .conflict-summary {
    color: var(--vgo-text-secondary);
  }

  .conflict-step {
    font-weight: 500;
  }

  .conflict-list {
    max-height: 180px;
    overflow: auto;
    border: 1px solid var(--vgo-border);
    border-radius: var(--vgo-radius);
    padding: var(--vgo-space-1);
  }

  .conflict-item {
    display: flex;
    align-items: center;
    gap: var(--vgo-space-2);
    padding: var(--vgo-space-1) var(--vgo-space-2);
    font-size: var(--vgo-font-sm);

    .conflict-item-name {
      flex: 1;
      min-width: 0;
    }

    .conflict-item-size {
      color: var(--vgo-text-secondary);
      white-space: nowrap;
    }
  }

  .conflict-truncated {
    padding: var(--vgo-space-1) var(--vgo-space-2);
    color: var(--vgo-text-secondary);
    font-size: var(--vgo-font-sm);
  }

  .conflict-warning {
    color: var(--vgo-danger);
    font-size: var(--vgo-font-sm);
  }

  .conflict-options {
    display: flex;
    flex-direction: column;
    gap: var(--vgo-space-1);
  }

  .conflict-compare {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--vgo-text-secondary);
    font-size: var(--vgo-font-sm);

    .compare-label {
      font-weight: 500;
    }
  }
}

.conflict-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--vgo-space-1);
}
</style>
