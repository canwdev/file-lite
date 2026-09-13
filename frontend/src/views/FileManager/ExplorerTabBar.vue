<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { ExplorerTab } from './ExplorerUI/explorer-tabs-store'
import ContextMenu from '@imengyu/vue3-context-menu'
import { useEventListener } from '@vueuse/core'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { resolveMenuIcons } from '@/utils/icons'
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
const SPRING_LOAD_MS = 500

const {
  tabs,
  activeTabId,
  canCloseTabs,
  addTab,
  closeTab,
  closeOthers,
  closeToLeft,
  closeToRight,
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

/** 标签右键菜单：关闭相关的操作都天然满足「至少保留 1 个」 */
function showTabMenu(tab: ExplorerTab, event: MouseEvent) {
  const index = tabs.value.findIndex(item => item.id === tab.id)
  const items: MenuItem[] = [
    {
      label: 'Close',
      icon: 'mdi mdi-close',
      disabled: !canCloseTabs.value,
      onClick: () => closeTab(tab.id),
    },
    {
      label: 'Close others',
      icon: 'mdi mdi-close-box-multiple-outline',
      disabled: tabs.value.length < 2,
      onClick: () => closeOthers(tab.id),
    },
    {
      label: 'Close to the left',
      icon: 'mdi mdi-arrow-collapse-left',
      disabled: index <= 0,
      onClick: () => closeToLeft(tab.id),
    },
    {
      label: 'Close to the right',
      icon: 'mdi mdi-arrow-collapse-right',
      disabled: index === -1 || index === tabs.value.length - 1,
      onClick: () => closeToRight(tab.id),
    },
  ]

  ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    ...menuThemeOptions,
    items: resolveMenuIcons(items),
  })
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
      @contextmenu.prevent.stop="showTabMenu(tab, $event)"
      @dragstart="onTabDragStart(tab, $event)"
      @dragover="onTabDragOver(tab, index, $event)"
      @drop="onTabDrop"
    >
      <span class="explorer-tabs__label vgo-u-text-overflow">{{ tabLabel(tab) }}</span>
      <button
        v-if="canCloseTabs"
        type="button"
        class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--sm explorer-tabs__close"
        title="Close tab"
        @click.stop="closeTab(tab.id)"
      >
        <i-mdi-close />
      </button>
    </div>

    <button
      type="button"
      class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--sm explorer-tabs__add"
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
  gap: 0;
  min-width: 0;
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
    // vgo-list-item 的 min-height 是 control-lg，会把顶栏撑得比 explorer-header 高
    height: var(--vgo-control-md);
    min-height: var(--vgo-control-md);
    padding: 0 var(--vgo-space-2);
    border-radius: var(--vgo-radius);
    overflow: hidden;
    outline: none;
    cursor: pointer;

    // 高亮只留底色，去掉 vgo-list-item.is-active 的 1px outline
    &.is-active {
      background-color: var(--vgo-primary-opacity);
    }

    // 相邻两个都不是活动标签时，中间画一条短分隔线
    &:not(.is-active) + &:not(.is-active)::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      width: 1px;
      height: var(--vgo-font-lg);
      transform: translateY(-50%);
      background-color: var(--vgo-border);
    }

    &.is-drag-source {
      opacity: 0.5;
    }

    // 拖拽排序的插入线
    &.is-drop-before::after,
    &.is-drop-after::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      width: 3px;
      background-color: var(--vgo-primary);
    }

    &.is-drop-before::after {
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

  /**
   * 高亮只留底色，去掉 vgo 的 1px outline。
   *
   * 主题规则是 `body.vgo-theme-default .vgo-list-item.is-active`（0,3,1），而 `&__item`
   * 只会编译成 `.explorer-tabs__item`（不会带上 .explorer-tabs 前缀），(0,3,0) 盖不住，
   * 所以这里显式再套一层父选择器。
   */
  .explorer-tabs__item.is-active {
    outline: none;
  }

  &__close {
    flex-shrink: 0;
    svg {
      font-size: var(--vgo-icon-sm);
    }
  }

  &__add {
    position: relative;
    flex-shrink: 0;
    font-size: var(--vgo-icon-sm);
    margin-inline-start: var(--vgo-space-1);
  }

  // + 左边也要有分隔线，规则与标签之间的一致（紧邻的活动标签旁边不画）
  .explorer-tabs__item:not(.is-active) + .explorer-tabs__add::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 1px;
    height: var(--vgo-font-lg);
    transform: translateY(-50%);
    background-color: var(--vgo-border);
  }
}
</style>
