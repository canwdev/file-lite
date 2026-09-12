<script setup lang="ts">
import type { IEntry } from '@/types/server'
import { ViewPortWindow } from '@canwdev/vgo-ui'
import { computed } from 'vue'
import MdiIcon from '@/components/MdiIcon.vue'
import { bytesToSize, formatDate } from '@/utils'
import { getFileIconClass } from './file-icons'
import { getEntryTypeLabel } from './file-type'
import {
  closeProperties,
  propertiesData,
  propertiesError,
  propertiesLoading,
  propertiesTarget,
  propertiesVisible,
} from './properties-window'

const target = computed(() => propertiesTarget.value)
const data = computed(() => propertiesData.value)

const displayName = computed(() => data.value.name || target.value?.name || '')
const isDirectory = computed(() => data.value.isDirectory ?? target.value?.isDirectory ?? false)
const ext = computed(() => data.value.ext ?? target.value?.ext ?? '')
const fullPath = computed(() => data.value.path || target.value?.absPath || '')
const typeLabel = computed(() => getEntryTypeLabel({ isDirectory: isDirectory.value, ext: ext.value }))
const iconClass = computed(() => getFileIconClass({ isDirectory: isDirectory.value, ext: ext.value } as IEntry))

const lastModified = computed(() => data.value.lastModified || target.value?.item?.lastModified || 0)
const birthtime = computed(() => data.value.birthtime || target.value?.item?.birthtime || 0)

/** 目录大小要等服务端后台统计；文件直接用列表里已有的字节数。 */
const sizeBytes = computed(() => {
  if (isDirectory.value) {
    return propertiesLoading.value ? null : (data.value.size ?? null)
  }
  return target.value?.item?.size ?? null
})

const sizeText = computed(() => {
  const bytes = sizeBytes.value
  if (bytes == null) {
    return null
  }
  return `${bytesToSize(bytes)} (${bytes.toLocaleString('en-US')} bytes)`
})

const containsText = computed(() => {
  if (!isDirectory.value || propertiesLoading.value) {
    return null
  }
  const files = data.value.fileCount
  const folders = data.value.folderCount
  if (files == null || folders == null) {
    return null
  }
  // 统计超时 / 被截断时只保证「至少这么多」
  const prefix = data.value.type === 'result' && data.value.complete === false ? 'More than ' : ''
  return `${prefix}${files} files, ${folders} folders`
})

interface PropertyRow {
  label: string
  value: string | null
  /** 完整路径等长文本允许换行 */
  wide?: boolean
}

const rows = computed<PropertyRow[]>(() => {
  const list: PropertyRow[] = [
    { label: 'Type', value: typeLabel.value },
    { label: 'Full path', value: fullPath.value, wide: true },
    { label: 'Size', value: sizeText.value },
  ]
  if (isDirectory.value) {
    list.push({ label: 'Contains', value: containsText.value })
  }
  list.push({
    label: 'Modified',
    value: lastModified.value ? formatDate(lastModified.value, 'YYYY-MM-DD HH:mm:ss') : null,
  })
  list.push({
    label: 'Created',
    value: birthtime.value ? formatDate(birthtime.value, 'YYYY-MM-DD HH:mm:ss') : null,
  })
  return list
})

function displayValue(row: PropertyRow) {
  if (row.value != null) {
    return row.value
  }
  return propertiesLoading.value ? 'Loading...' : '—'
}

function handleVisibleChange(visible: boolean) {
  if (visible) {
    propertiesVisible.value = true
  }
  else {
    closeProperties()
  }
}
</script>

<template>
  <ViewPortWindow
    :visible="propertiesVisible"
    :allow-maximum="false"
    :allow-minimum="false"
    init-center
    :init-win-options="{ width: 'min(460px, 92vw)', height: 'auto' }"
    @update:visible="handleVisibleChange"
    @on-close="closeProperties"
  >
    <template #titleBarLeft>
      <MdiIcon name="information-outline" />
      <span class="properties-title">{{ displayName }} Properties</span>
    </template>

    <div class="properties-window">
      <div class="properties-header">
        <MdiIcon class="properties-header-icon" :name="iconClass" />
        <span class="properties-header-name">{{ displayName }}</span>
      </div>

      <div class="properties-rows">
        <div
          v-for="row in rows"
          :key="row.label"
          class="properties-row"
          :class="{ 'is-wide': row.wide }"
        >
          <span class="properties-label">{{ row.label }}:</span>
          <span class="properties-value" :title="row.value || undefined">{{ displayValue(row) }}</span>
        </div>
      </div>

      <div v-if="propertiesError" class="properties-error">
        {{ propertiesError }}
      </div>

      <div class="properties-footer">
        <button class="vgo-button vgo-button--primary" @click="closeProperties">
          OK
        </button>
      </div>
    </div>
  </ViewPortWindow>
</template>

<style scoped lang="scss">
.properties-window {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-3);
  padding: var(--vgo-space-3);
}

.properties-header {
  display: flex;
  gap: var(--vgo-space-3);
  align-items: center;
  min-width: 0;

  .properties-header-icon {
    flex-shrink: 0;
    font-size: calc(var(--vgo-icon-lg) * 2);
    color: var(--vgo-primary);
  }

  .properties-header-name {
    font-size: var(--vgo-font-lg);
    font-weight: 600;
    word-break: break-word;
  }
}

.properties-rows {
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-1);
}

.properties-row {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: var(--vgo-space-2);
  align-items: baseline;
  font-size: var(--vgo-font-sm);

  &.is-wide {
    align-items: start;
  }

  .properties-label {
    color: var(--vgo-text-secondary);
  }

  .properties-value {
    min-width: 0;
    word-break: break-all;
    user-select: text;
  }
}

.properties-error {
  color: var(--vgo-danger);
  font-size: var(--vgo-font-sm);
}

.properties-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
