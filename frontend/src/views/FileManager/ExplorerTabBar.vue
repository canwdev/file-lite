<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { ExplorerTab, ExplorerTabItem } from './ExplorerUI/explorer-tabs-store'
import ContextMenu from '@imengyu/vue3-context-menu'
import { useEventListener } from '@vueuse/core'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { resolveMenuIcons } from '@/utils/icons'
import { isExternalFileDrag, isInternalDrag } from './ExplorerUI/entry-drag'
import { isSplitItem, useExplorerTabs } from './ExplorerUI/explorer-tabs-store'
import { getLastDirName, normalizeListingPath } from './utils'

/**
 * 内置标签栏。只负责「标签长什么样 + 怎么操作」，路径与激活状态都在 store 里。
 *
 * 一项 = 一个标签条格子：单标签项含 1 个面板，拆分项含 2 个面板（左右并排或上下堆叠），
 * 两个面板在标签条上合并展示，共享一个关闭按钮。
 *
 * 两种拖拽必须分开：
 * - 标签自己的排序拖拽（TAB_DRAG_MIME）：preventDefault，标签是合法落点；
 * - 拖文件经过标签（内部条目拖拽 / 系统文件）：**不** preventDefault，标签不接收文件，
 *   只做 1s「弹簧加载」——悬停够久就切过去，用户再在内容区放下。
 */
const TAB_DRAG_MIME = 'application/x-file-lite-tab'
const SPRING_LOAD_MS = 500

const {
  items,
  activeItemId,
  canCloseTabs,
  addTab,
  closeTab,
  closeOthers,
  closeToLeft,
  closeToRight,
  activateTab,
  activateItem,
  moveTab,
  splitTab,
  unsplit,
  toggleSplitDirection,
  swapSplitPanes,
  syncSplitPath,
} = useExplorerTabs()

const tabBarRef = ref<HTMLElement | null>(null)

/* ---------------- 排序拖拽 ---------------- */
const dragTabId = ref<string | null>(null)
/** 插入位置：0..items.length，按指针在标签左 / 右半边计算 */
const tabDropIndex = ref<number | null>(null)

function isTabDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes(TAB_DRAG_MIME)
}

function resetTabDrag() {
  dragTabId.value = null
  tabDropIndex.value = null
}

function onTabDragStart(item: ExplorerTabItem, event: DragEvent) {
  dragTabId.value = item.id
  event.dataTransfer?.setData(TAB_DRAG_MIME, item.id)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onTabDragOver(item: ExplorerTabItem, index: number, event: DragEvent) {
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
  scheduleSpringLoad(item.id)
}

function onTabDrop(event: DragEvent) {
  if (!isTabDrag(event)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const from = items.value.findIndex(item => item.id === dragTabId.value)
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

function scheduleSpringLoad(itemId: string) {
  if (activeItemId.value === itemId || springTabId.value === itemId) {
    return
  }
  cancelSpringLoad()
  springTabId.value = itemId
  springTimer = setTimeout(() => {
    springTimer = null
    springTabId.value = null
    activateItem(itemId)
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

function onTabAuxClick(item: ExplorerTabItem, event: MouseEvent) {
  // 中键关闭整个标签项，与浏览器一致
  if (event.button === 1) {
    event.preventDefault()
    closeTab(item.id)
  }
}

function onTabKeydown(item: ExplorerTabItem, event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    activateItem(item.id)
  }
}

/** 两个面板已经在同一个目录：Sync path 无事可做 */
function isSplitPathSynced(item: ExplorerTabItem) {
  return normalizeListingPath(item.tabs[0].path) === normalizeListingPath(item.tabs[1].path)
}

/** 拆分项的子菜单：取消拆分 / 切换方向（文案与图标都描述**目标**方向） / 交换视图 / 同步目录 */
function splitSubmenu(item: ExplorerTabItem): MenuItem[] {
  const vertical = item.split !== 'horizontal'
  return [
    {
      label: 'Unsplit',
      onClick: () => unsplit(item.id),
    },
    vertical
      ? {
          label: 'Split horizontally',
          icon: 'mdi mdi-arrow-split-horizontal',
          onClick: () => toggleSplitDirection(item.id),
        }
      : {
          label: 'Split vertically',
          icon: 'mdi mdi-arrow-split-vertical',
          onClick: () => toggleSplitDirection(item.id),
        },
    {
      label: 'Swap views',
      icon: vertical ? 'mdi mdi-swap-horizontal' : 'mdi mdi-swap-vertical',
      onClick: () => swapSplitPanes(item.id),
    },
    {
      label: 'Sync path',
      disabled: isSplitPathSynced(item),
      onClick: () => syncSplitPath(item.id),
    },
  ]
}

/** 关闭相关的操作都天然满足「至少保留 1 项」 */
function closeSubmenu(item: ExplorerTabItem, index: number): MenuItem[] {
  return [
    {
      label: 'Close',
      icon: 'mdi mdi-close',
      disabled: !canCloseTabs.value,
      onClick: () => closeTab(item.id),
    },
    {
      label: 'Close others',
      icon: 'mdi mdi-close-box-multiple-outline',
      disabled: items.value.length < 2,
      onClick: () => closeOthers(item.id),
    },
    {
      label: 'Close to the left',
      icon: 'mdi mdi-arrow-collapse-left',
      disabled: index <= 0,
      onClick: () => closeToLeft(item.id),
    },
    {
      label: 'Close to the right',
      icon: 'mdi mdi-arrow-collapse-right',
      disabled: index === -1 || index === items.value.length - 1,
      onClick: () => closeToRight(item.id),
    },
  ]
}

/** 标签右键菜单：新增的「拆分视图」放最上面并压一条分隔线，原有的关闭项保持在最下面 */
function showTabMenu(item: ExplorerTabItem, event: MouseEvent) {
  const index = items.value.findIndex(entry => entry.id === item.id)
  const splitView: MenuItem = isSplitItem(item)
    ? {
        label: 'Split view',
        icon: item.split === 'horizontal' ? 'mdi mdi-arrow-split-horizontal' : 'mdi mdi-arrow-split-vertical',
        divided: true,
        children: splitSubmenu(item),
      }
    : {
        label: 'Split view',
        icon: 'mdi mdi-arrow-split-vertical',
        divided: true,
        onClick: () => splitTab(item.id),
      }

  const menuItems: MenuItem[] = [splitView, ...closeSubmenu(item, index)]

  ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    ...menuThemeOptions,
    items: resolveMenuIcons(menuItems),
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
      v-for="(item, index) in items"
      :key="item.id"
      class="vgo-list-item explorer-tabs__item"
      :class="{
        'is-active': item.id === activeItemId,
        'is-split': isSplitItem(item),
        'is-drag-source': item.id === dragTabId,
        'is-drop-before': tabDropIndex === index,
        'is-drop-after': tabDropIndex === index + 1 && index === items.length - 1,
        'is-drop-pending': item.id === springTabId,
      }"
      role="tab"
      :aria-selected="item.id === activeItemId"
      tabindex="0"
      :title="isSplitItem(item) ? undefined : item.tabs[0].path"
      :draggable="true"
      @click="activateItem(item.id)"
      @keydown="onTabKeydown(item, $event)"
      @auxclick="onTabAuxClick(item, $event)"
      @contextmenu.prevent.stop="showTabMenu(item, $event)"
      @dragstart="onTabDragStart(item, $event)"
      @dragover="onTabDragOver(item, index, $event)"
      @drop="onTabDrop"
    >
      <span
        v-for="pane in item.tabs"
        :key="pane.id"
        class="explorer-tabs__half"
        :class="{ 'is-focused': pane.id === item.activeTabId }"
        :title="pane.path"
        @click="activateTab(pane.id)"
      >
        <span class="explorer-tabs__label vgo-u-text-overflow">{{ tabLabel(pane) }}</span>
      </span>
      <button
        v-if="canCloseTabs"
        type="button"
        class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--sm explorer-tabs__close"
        title="Close tab"
        @click.stop="closeTab(item.id)"
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
    padding: 0 var(--vgo-space-1);
    border-radius: var(--vgo-radius);
    overflow: hidden;
    outline: none;
    cursor: pointer;
    font-size: var(--vgo-font-sm);
    transition: background-color .3s;

    // 拆分项里有两个标题：至少 10rem（实测单个标签约 5.7rem），两个标题都能完整显示；
    // 字号缩一档，上限取单标签上限的 1.5 倍
    &.is-split {
      min-width: 10rem;
      max-width: 18rem;
    }

    // 高亮只留底色，去掉 vgo-list-item.is-active 的 1px outline
    &.is-active {
      background-color: var(--vgo-primary-opacity);
      transition: background-color 0s;
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

  /** 一个面板在一项里占的那半边：单标签项就是一整块标题 */
  &__half {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 100%;
    // 标题不要贴住分隔线 / 标签边缘
    padding-inline: var(--vgo-space-1);

    // 拆分项里两个标题之间的分隔线
    & + &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      width: 1px;
      height: 30%;
      transform: translateY(-50%);
      background-color: var(--vgo-border);
    }

    // 拆分项里没聚焦的那半压暗，一眼能看出当前面板是哪个
    &:not(.is-focused) {
      color: var(--vgo-text-secondary);
    }
  }

  &__label {
    flex: 1;
    min-width: 0;
    line-height: 1.4;
    text-align: center;
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
