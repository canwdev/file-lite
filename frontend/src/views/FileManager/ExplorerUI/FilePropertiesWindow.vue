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
  propertiesIsMulti,
  propertiesItems,
  propertiesLoading,
  propertiesTarget,
  propertiesVisible,
} from './properties-window'

const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss'

const target = computed(() => propertiesTarget.value)
const data = computed(() => propertiesData.value)

// ---- 单选 ----

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

// ---- 多选聚合 ----

const multiCount = computed(() => propertiesItems.value.length)
const multiFileCount = computed(() => propertiesItems.value.filter(item => !item.target.isDirectory).length)
const multiFolderCount = computed(() => multiCount.value - multiFileCount.value)
const multiMeasuredFolders = computed(
  () => propertiesItems.value.filter(item => item.target.isDirectory && item.measured).length,
)
/** 所有目录都统计完（文件天然已完成）才算就绪，之前一律显示 Loading。 */
const multiReady = computed(() => propertiesItems.value.every(item => item.measured))
/** 统计被截断、出错或文件大小缺失时，合计只是「至少这么多」。 */
const multiIncomplete = computed(
  () => propertiesItems.value.some(
    item => item.error || !item.complete || (!item.target.isDirectory && item.size == null),
  ),
)
const multiTotalBytes = computed(
  () => propertiesItems.value.reduce((sum, item) => sum + (item.size ?? 0), 0),
)

const typeText = computed(() => {
  if (!propertiesIsMulti.value) {
    return typeLabel.value
  }
  const parts: string[] = []
  if (multiFileCount.value) {
    parts.push(`${multiFileCount.value} file${multiFileCount.value === 1 ? '' : 's'}`)
  }
  if (multiFolderCount.value) {
    parts.push(`${multiFolderCount.value} folder${multiFolderCount.value === 1 ? '' : 's'}`)
  }
  return parts.join(', ')
})

function dirName(path: string) {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash < 0 ? '' : trimmed.slice(0, slash)
}

/** 多选时的公共父目录；全在同一层就直接显示该目录，否则退到最深公共层。 */
const multiLocation = computed(() => {
  const dirs = propertiesItems.value.map(item => dirName(item.target.absPath))
  if (!dirs.length) {
    return null
  }
  if (dirs.every(dir => dir === dirs[0])) {
    return dirs[0] || '/'
  }
  const segments = dirs.map(dir => dir.split('/'))
  const first = segments[0]
  let end = first.length
  for (let i = 1; i < segments.length; i++) {
    const parts = segments[i]
    let j = 0
    while (j < end && j < parts.length && parts[j] === first[j]) {
      j++
    }
    end = j
  }
  return first.slice(0, end).join('/') || null
})

function formatDateRange(values: number[]) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value <= 0) {
      continue
    }
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (min === Number.POSITIVE_INFINITY) {
    return null
  }
  if (min === max) {
    return formatDate(min, DATE_FORMAT)
  }
  return `${formatDate(min, DATE_FORMAT)} — ${formatDate(max, DATE_FORMAT)}`
}

const sizeText = computed(() => {
  if (propertiesIsMulti.value) {
    if (!multiReady.value) {
      return null
    }
    const total = multiTotalBytes.value
    const prefix = multiIncomplete.value ? 'More than ' : ''
    return `${prefix}${bytesToSize(total)} (${total.toLocaleString('en-US')} bytes)`
  }
  const bytes = sizeBytes.value
  if (bytes == null) {
    return null
  }
  return `${bytesToSize(bytes)} (${bytes.toLocaleString('en-US')} bytes)`
})

const containsText = computed(() => {
  if (propertiesIsMulti.value) {
    const folders = propertiesItems.value.filter(item => item.target.isDirectory)
    if (!folders.length || !multiReady.value) {
      return null
    }
    const files = folders.reduce((sum, item) => sum + (item.fileCount ?? 0), 0)
    const subFolders = folders.reduce((sum, item) => sum + (item.folderCount ?? 0), 0)
    const prefix = folders.some(item => item.error || !item.complete) ? 'More than ' : ''
    return `${prefix}${files} files, ${subFolders} folders`
  }
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
  if (propertiesIsMulti.value) {
    const list: PropertyRow[] = [
      { label: 'Type', value: typeText.value },
      { label: 'Full path', value: multiLocation.value ?? 'Multiple locations', wide: true },
      { label: 'Size', value: sizeText.value },
    ]
    if (multiFolderCount.value) {
      list.push({ label: 'Contains', value: containsText.value })
    }
    list.push({ label: 'Modified', value: formatDateRange(propertiesItems.value.map(item => item.lastModified)) })
    list.push({ label: 'Created', value: formatDateRange(propertiesItems.value.map(item => item.birthtime)) })
    return list
  }

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
    value: lastModified.value ? formatDate(lastModified.value, DATE_FORMAT) : null,
  })
  list.push({
    label: 'Created',
    value: birthtime.value ? formatDate(birthtime.value, DATE_FORMAT) : null,
  })
  return list
})

// ---- 头部与状态 ----

const titleText = computed(() => (propertiesIsMulti.value ? 'Properties' : `${displayName.value} Properties`))
const headerIcon = computed(() => (propertiesIsMulti.value ? 'file-multiple-outline' : iconClass.value))
const headerName = computed(() => (propertiesIsMulti.value ? `${multiCount.value} items selected` : displayName.value))

/** 多选时正在统计的目录进度。 */
const measureProgress = computed(() => {
  if (!propertiesIsMulti.value || !propertiesLoading.value || !multiFolderCount.value) {
    return null
  }
  return `Measuring folders... ${multiMeasuredFolders.value} / ${multiFolderCount.value}`
})

const displayError = computed(() => {
  if (!propertiesIsMulti.value) {
    return propertiesError.value
  }
  const failed = propertiesItems.value.filter(item => item.error).length
  return failed ? `Could not read ${failed} of ${multiCount.value} items` : null
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
      <span class="properties-title">{{ titleText }}</span>
    </template>

    <div class="properties-window">
      <div class="properties-header">
        <MdiIcon class="properties-header-icon" :name="headerIcon" />
        <span
          class="properties-header-name"
          :class="{ 'vgo-u-font-code': !propertiesIsMulti }"
        >{{ headerName }}</span>
      </div>

      <div class="properties-rows ">
        <div
          v-for="row in rows"
          :key="row.label"
          class="properties-row"
          :class="{ 'is-wide': row.wide }"
        >
          <span class="properties-label">{{ row.label }}:</span>
          <span class="properties-value vgo-u-font-code">{{ displayValue(row) }}</span>
        </div>
      </div>

      <div v-if="measureProgress" class="properties-progress">
        {{ measureProgress }}
      </div>

      <div v-if="displayError" class="properties-error">
        {{ displayError }}
      </div>

      <div class="properties-footer">
        <button class="vgo-button vgo-button--primary" @click="closeProperties">
          Done
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
  gap: var(--vgo-space-3);
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

.properties-progress {
  color: var(--vgo-text-secondary);
  font-size: var(--vgo-font-sm);
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
