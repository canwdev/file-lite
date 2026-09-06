<script setup lang="ts">
import type { IEntry } from '@/types/server.ts'
import { VueRender } from '@canwdev/vgo-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

// 表头列配置接口
export interface Column {
  key: string
  label: string
  width?: number // 初始宽度
  formatter?: (row: any) => string
  render?: (row: any) => VNode
  // 表头点击事件
  columnClick?: (col: Column, event: MouseEvent) => void
  columnRightRender?: (col: Column) => VNode
  sortModes?: any[]
}

interface VirtualRow {
  item: any
  index: number
}

const props = withDefaults(
  defineProps<{
    columns: Column[]
    data: any[]
    virtualRows?: VirtualRow[]
    virtualBeforeHeight?: number
    virtualAfterHeight?: number
    virtualRowHeight?: number
    getTooltip?: (row: any) => string
    cutNames?: Set<string>
    selectedRows: Set<any>
    customToggle?: (params: {
      item: IEntry
      event: MouseEvent
      toggle?: boolean
    }) => void
    rowContextmenu?: (row: any, event: MouseEvent) => void
  }>(),
  {},
)

const emit = defineEmits(['update:selectedRows', 'open'])

const { selectedRows, data } = toRefs(props)
const mSelectedRows = ref(new Set())
const renderedRows = computed(() => {
  return props.virtualRows ?? data.value.map((item, index) => ({ item, index }))
})
const columnSpan = computed(() => props.columns.length + 1)

watch(
  selectedRows,
  (newSet) => {
    mSelectedRows.value = new Set(newSet)
  },
  { deep: true, immediate: true },
)

const columnWidths = ref<Record<string, number>>({})

// 监听 props.columns 的变化，初始化列宽
watch(
  () => props.columns,
  (newColumns) => {
    const initialWidths: Record<string, number> = {}
    newColumns.forEach((col) => {
      if (col.width) {
        initialWidths[col.key] = col.width
      }
    })
    columnWidths.value = initialWidths
  },
  { immediate: true, deep: true },
)

// "全选" 复选框的状态
const isAllSelected = computed(() => {
  return (
    data.value.length > 0
    && data.value.every(row => mSelectedRows.value.has(row))
  )
})

// "全选" 复选框的半选状态
const isIndeterminate = computed(() => {
  return mSelectedRows.value.size > 0 && !isAllSelected.value
})

// 获取嵌套属性值，例如 'user.name'
function getRowValue(row: any, column: Column) {
  // 处理格式化
  if (column.formatter) {
    return column.formatter(row)
  }
  return (column.key || '').split('.').reduce((obj, k) => (obj || {})[k], row)
}

// 获取列的样式（主要是宽度）
function getColumnStyle(column: Column) {
  const width = columnWidths.value[column.key]
  return width ? { width: `${width}px`, minWidth: `${width}px` } : {}
}

// 切换单行选中
function toggleRowSelection(row: any, event: MouseEvent, toggle = false) {
  if (props.customToggle) {
    props.customToggle({
      item: row,
      event,
      toggle,
    })
    return
  }
  if (mSelectedRows.value.has(row)) {
    mSelectedRows.value.delete(row)
  }
  else {
    mSelectedRows.value.add(row)
  }
  emit('update:selectedRows', new Set(mSelectedRows.value))
}

// 切换全选
function toggleAllSelection() {
  if (isAllSelected.value) {
    data.value.forEach(row => mSelectedRows.value.delete(row))
  }
  else {
    data.value.forEach(row => mSelectedRows.value.add(row))
  }
  emit('update:selectedRows', new Set(mSelectedRows.value))
}

// ----------------- 列宽拖拽逻辑 -----------------

const resizingState = ref({
  active: false,
  key: '',
  startX: 0,
  startWidth: 0,
})

function startResize(event: MouseEvent | TouchEvent, columnKey: string) {
  event.stopPropagation()
  event.preventDefault()

  const isTouchEvent = 'touches' in event
  const targetTh = (event.target as HTMLElement).closest('th')
  if (!targetTh)
    return

  resizingState.value = {
    active: true,
    key: columnKey,
    startX: isTouchEvent ? event.touches[0].clientX : event.clientX,
    startWidth: targetTh.offsetWidth,
  }

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.addEventListener('touchmove', handleResize)
  document.addEventListener('touchend', stopResize)
}

function handleResize(event: MouseEvent | TouchEvent) {
  if (!resizingState.value.active)
    return

  const isTouchEvent = 'touches' in event
  const currentX = isTouchEvent ? event.touches[0].clientX : event.clientX
  const deltaX = currentX - resizingState.value.startX
  const newWidth = resizingState.value.startWidth + deltaX

  // 设置最小宽度
  const minWidth = 50
  columnWidths.value[resizingState.value.key] = Math.max(newWidth, minWidth)
}

function stopResize() {
  resizingState.value.active = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.removeEventListener('touchmove', handleResize)
  document.removeEventListener('touchend', stopResize)
}

// 组件卸载时移除事件监听器
onBeforeUnmount(() => {
  stopResize()
})
</script>

<template>
  <div class="file-table-wrapper">
    <table>
      <thead class="vgo-u-surface">
        <tr>
          <!-- 多选列 -->
          <th
            class="checkbox-col clickable" :style="{ width: '30px' }"
            @click.stop="toggleAllSelection"
          >
            <MdiIcon
              class="checkbox"
              :name="isIndeterminate
                ? 'checkbox-intermediate'
                : isAllSelected ? 'checkbox-marked' : 'checkbox-blank-outline'"
            />
          </th>
          <!-- 数据列 -->
          <th
            v-for="column in columns"
            :key="column.key"
            :style="getColumnStyle(column)"
            :class="{ clickable: !!column.columnClick }"
            @click="
              column.columnClick ? column.columnClick(column, $event) : () => {}
            "
          >
            <div class="header-cell">
              <span>{{ column.label }}</span>
              <VueRender
                v-if="column.columnRightRender"
                :render-fn="column.columnRightRender"
                :params="column"
              />
              <div
                class="resizer"
                @click.stop
                @mousedown.stop="startResize($event, column.key)"
                @touchstart.stop="startResize($event, column.key)"
              />
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="virtualBeforeHeight" class="virtual-spacer" aria-hidden="true">
          <td :colspan="columnSpan" :style="{ height: `${virtualBeforeHeight}px` }" />
        </tr>
        <tr
          v-for="{ item: row, index } in renderedRows"
          :key="row.id || row.name || index"
          class="vgo-list-item table-row selectable"
          :class="{ 'is-active': mSelectedRows.has(row), 'is-cut': cutNames?.has(row.name) }"
          :style="virtualRowHeight ? { height: `${virtualRowHeight}px` } : undefined"
          :title="getTooltip ? getTooltip(row) : ''"
          :data-name="row.name"
          @click.stop="toggleRowSelection(row, $event)"
          @dblclick.stop="$emit('open', row)"
          @contextmenu.prevent.stop="
            rowContextmenu ? rowContextmenu(row, $event) : () => {}
          "
        >
          <td
            class="checkbox-col"
            @click.stop="toggleRowSelection(row, $event, true)"
          >
            <MdiIcon
              :name="mSelectedRows.has(row) ? 'checkbox-marked' : 'checkbox-blank-outline'"
              class="checkbox checkbox-auto-hidden"
            />
          </td>
          <td
            v-for="column in columns"
            :key="column.key"
            :style="getColumnStyle(column)"
          >
            <slot :name="`cell-${column.key}`" :row="row" :column="column">
              <VueRender
                v-if="column.render"
                :render-fn="column.render"
                :params="row"
              />
              <template v-else>
                {{ getRowValue(row, column) }}
              </template>
            </slot>
          </td>
        </tr>
        <tr v-if="virtualAfterHeight" class="virtual-spacer" aria-hidden="true">
          <td :colspan="columnSpan" :style="{ height: `${virtualAfterHeight}px` }" />
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style lang="scss" scoped>
.file-table-wrapper {
  table {
    width: 500px;
    border-collapse: collapse;
    table-layout: fixed; /* 关键属性，使宽度设置生效 */
  }

  th,
  td {
    padding: var(--vgo-space-2);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    @media screen and (max-width: $mq_mobile_width) {
      padding: 10px var(--vgo-space-2);
    }
  }

  thead {
    position: sticky;
    top: 0;
    z-index: var(--vgo-z-sticky);
  }

  th {
    position: relative;
    &.clickable {
      cursor: pointer;
      &:hover {
        background-color: var(--vgo-hover);
      }
    }
  }

  // .vgo-list-item 默认是 flex 行，表格行需要还原为 table-row
  .table-row {
    display: table-row;
    min-height: 0;
    padding: 0;

    &:hover .checkbox-auto-hidden,
    &.is-active .checkbox-auto-hidden {
      visibility: visible;
    }

    &.is-cut :deep(.themed-icon) {
      opacity: 0.45;
    }
  }

  .virtual-spacer {
    pointer-events: none;
    td {
      padding: 0;
      border: 0;
    }
  }

  .checkbox-auto-hidden {
    visibility: hidden;
    vertical-align: middle;
    @media screen and (max-width: $mq_mobile_width) {
      visibility: visible;
    }
  }

  .header-cell {
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: var(--vgo-space-2);
    font-size: var(--vgo-font-md);
  }

  .sort-icon span {
    display: inline-block;
    line-height: 1;
  }

  .resizer {
    position: absolute;
    top: 0;
    right: 0;
    width: 1px;
    height: 100%;
    cursor: col-resize;
    z-index: var(--vgo-z-sticky);
    background-color: var(--vgo-border);
    &:active {
      background-color: var(--vgo-primary);
      &::after {
        background-color: var(--vgo-primary);
      }
    }
    &::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      transform: translate(-50%);
      width: 8px;
      z-index: var(--vgo-z-sticky);
    }
  }

  .checkbox-col {
    text-align: center;
    text-overflow: unset;
    cursor: pointer;
    .checkbox {
      font-size: var(--vgo-icon-sm);
      vertical-align: middle;
      line-height: 14px;
    }
  }
}
</style>
