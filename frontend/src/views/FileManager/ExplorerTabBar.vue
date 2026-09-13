<script setup lang="ts">
import type { ExplorerTab } from './ExplorerUI/explorer-tabs-store'
import { useEventListener } from '@vueuse/core'
import { isExternalFileDrag, isInternalDrag } from './ExplorerUI/entry-drag'
import { useExplorerTabs } from './ExplorerUI/explorer-tabs-store'
import { getLastDirName } from './utils'

/**
 * 内置标签栏。只负责「标签长什么样 + 怎么操作」，路径与激活状态都在 store 里。
 *
 * 两种拖拽必须分开：
 * - 标签自己的排序拖拽（TAB_DRAG_MIME）：preventDefault，标签是合法落点；
 * - 拖文件经过标签（内部条目拖拽 / 系统文件）：**不** preventDefault，标签不接收文件，
 *   只做 1s「弹簧加载」——悬停够久就切过去，用户再在内容区放下。
 */
const TAB_DRAG_MIME = 'application/x-file-lite-tab'
const SPRING_LOAD_MS = 1000

const {
  tabs,
  activeTabId,
  canCloseTabs,
  addTab,
  closeTab,
  activateTab,
  moveTab,
} = useExplorerTabs()

const tabBarRef = ref<HTMLElement | null>(null)

/* ---------------- 排序拖拽 ---------------- */
const dragTabId = ref<string | null>(null)
/** 插入位置：0..tabs.length，按指针在标签左 / 右半边计算 */
const tabDropIndex = ref<number | null>(null)

function isTabDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes(TAB_DRAG_MIME)
}

function resetTabDrag() {
  dragTabId.value = null
  tabDropIndex.value = null
}

function onTabDragStart(tab: ExplorerTab, event: DragEvent) {
  dragTabId.value = tab.id
  event.dataTransfer?.setData(TAB_DRAG_MIME, tab.id)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onTabDragOver(tab: ExplorerTab, index: number, event: DragEvent) {
  if (isTabDrag(event)) {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    tabDropIndex.value = event.clientX > rect.left + rect.width / 2 ? index + 1 : index
    cancelSpringLoad()
    return
  }

  if (!isInternalDrag(event) && !isExternalFileDrag(event)) {
    return
  }
  // 标签不接受文件：这里刻意不 preventDefault，只计时
  scheduleSpringLoad(tab.id)
}

function onTabDrop(event: DragEvent) {
  if (!isTabDrag(event)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const from = tabs.value.findIndex(tab => tab.id === dragTabId.value)
  const to = tabDropIndex.value
  resetTabDrag()
  if (from !== -1 && to !== null) {
    moveTab(from, to)
  }
}

function onTabDragLeave(event: DragEvent) {
  const next = event.relatedTarget as Node | null
  if (next && tabBarRef.value?.contains(next)) {
    return
  }
  tabDropIndex.value = null
  cancelSpringLoad()
}

/* ---------------- 弹簧加载：悬停 1s 自动切过去 ---------------- */
const springTabId = ref<string | null>(null)
let springTimer: ReturnType<typeof setTimeout> | null = null

function cancelSpringLoad() {
  if (springTimer) {
    clearTimeout(springTimer)
    springTimer = null
  }
  springTabId.value = null
}

function scheduleSpringLoad(tabId: string) {
  if (activeTabId.value === tabId || springTabId.value === tabId) {
    return
  }
  cancelSpringLoad()
  springTabId.value = tabId
  springTimer = setTimeout(() => {
    springTimer = null
    springTabId.value = null
    activateTab(tabId)
  }, SPRING_LOAD_MS)
}

useEventListener(window, 'dragend', () => {
  resetTabDrag()
  cancelSpringLoad()
})
useEventListener(window, 'drop', () => {
  resetTabDrag()
  cancelSpringLoad()
})
onBeforeUnmount(cancelSpringLoad)

/* ---------------- 基本操作 ---------------- */
function tabLabel(tab: ExplorerTab) {
  return getLastDirName(tab.path) || tab.path || '/'
}

function onTabAuxClick(tab: ExplorerTab, event: MouseEvent) {
  // 中键关闭，与浏览器一致
  if (event.button === 1) {
    event.preventDefault()
    closeTab(tab.id)
  }
}

function onTabKeydown(tab: ExplorerTab, event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    activateTab(tab.id)
  }
}
</script>

<template>
  <div
    ref="tabBarRef"
    class="explorer-tabs"
    role="tablist"
    aria-label="Open folders"
    @dragleave="onTabDragLeave"
  >
    <div
      v-for="(tab, index) in tabs"
      :key="tab.id"
      class="vgo-list-item explorer-tabs__item"
      :class="{
        'is-active': tab.id === activeTabId,
        'is-drag-source': tab.id === dragTabId,
        'is-drop-before': tabDropIndex === index,
        'is-drop-after': tabDropIndex === index + 1 && index === tabs.length - 1,
        'is-drop-pending': tab.id === springTabId,
      }"
      role="tab"
      :aria-selected="tab.id === activeTabId"
      tabindex="0"
      :title="tab.path"
      :draggable="true"
      @click="activateTab(tab.id)"
      @keydown="onTabKeydown(tab, $event)"
      @auxclick="onTabAuxClick(tab, $event)"
      @dragstart="onTabDragStart(tab, $event)"
      @dragover="onTabDragOver(tab, index, $event)"
      @drop="onTabDrop"
    >
      <span class="explorer-tabs__label vgo-u-text-overflow">{{ tabLabel(tab) }}</span>
      <button
        type="button"
        class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm explorer-tabs__close"
        :disabled="!canCloseTabs"
        :title="canCloseTabs ? 'Close tab' : 'At least one tab is kept open'"
        @click.stop="closeTab(tab.id)"
      >
        <i-mdi-close />
      </button>
    </div>

    <button
      type="button"
      class="vgo-button vgo-button--text vgo-button--icon vgo-button--md explorer-tabs__add"
      title="New tab"
      @click="addTab()"
    >
      <i-mdi-plus />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.explorer-tabs {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: var(--vgo-space-1);
  // 标签多了就互相挤压，不换行
  flex-wrap: nowrap;
  overflow: hidden;

  &__item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--vgo-space-1);
    // 挤压：可以长到 12rem，也可以缩到 2.5rem，标题省略号
    flex: 1 1 auto;
    min-width: 2.5rem;
    max-width: 12rem;
    height: var(--vgo-control-md);
    padding-inline: var(--vgo-space-2);
    overflow: hidden;
    cursor: pointer;

    // 高亮只留底色，去掉 vgo-list-item.is-active 的 1px outline
    &.is-active {
      outline: none;
    }

    &.is-drag-source {
      opacity: 0.5;
    }

    // 拖拽排序的插入线
    &.is-drop-before::before,
    &.is-drop-after::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background-color: var(--vgo-primary);
    }

    &.is-drop-before::before {
      left: -1px;
    }

    &.is-drop-after::after {
      right: -1px;
    }

    // 弹簧加载等待中：只是提示，不会有动画
    &.is-drop-pending {
      background-color: var(--vgo-primary-opacity);
    }
  }

  &__label {
    flex: 1;
    min-width: 0;
    line-height: 1.4;
    text-align: initial;
  }

  &__close {
    flex-shrink: 0;
  }

  &__add {
    flex-shrink: 0;
  }
}
</style>
