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
/** One geometry symbol for every tab. `use` cannot share a duplicated id. */
const geometryId = `explorer-tab-geometry-${useId().replace(/[^\w-]/g, '')}`

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
      shortcut: 'Ctrl+\\',
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
      shortcut: 'Alt+W',
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
        shortcut: 'Ctrl+\\',
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
    <svg class="explorer-tabs__defs" aria-hidden="true">
      <defs>
        <symbol :id="geometryId" viewBox="0 0 214 36">
          <!--
            Chrome's path has a 2px bottom stub (v-2) that tucks under the
            browser chrome bar. Without that bar it shows as a 1px step, so
            the curve starts on the baseline instead.
          -->
          <path d="M17 0h197v36H0c4.5 0 9-3.5 9-8V8c0-4.5 3.5-8 8-8z" />
        </symbol>
      </defs>
    </svg>

    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="explorer-tabs__item"
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
      <!-- Shoulder geometry: left slice + mirrored right slice, so the curve stays a fixed width. -->
      <svg class="explorer-tabs__shape" aria-hidden="true">
        <!--
          Native geometry is 214×36. Width is scaled by tab-height/36 so the
          curve stays round (preserveAspectRatio would otherwise letterbox it).
          Tab height = control-md + space-1 → 214 * 34/36 ≈ 201.889.
        -->
        <svg width="52%" height="100%">
          <use :href="`#${geometryId}`" width="201.889" height="100%" preserveAspectRatio="none" fill="currentColor" />
        </svg>
        <g transform="scale(-1, 1)">
          <svg width="52%" height="100%" x="-100%" y="0">
            <use :href="`#${geometryId}`" width="201.889" height="100%" preserveAspectRatio="none" fill="currentColor" />
          </svg>
        </g>
      </svg>
      <span
        v-for="pane in item.tabs"
        :key="pane.id"
        class="explorer-tabs__half"
        :class="{ 'is-focused': pane.id === item.activeTabId }"
        :title="pane.path"
        @click="activateTab(pane.id)"
      >
        <i-mdi-folder class="explorer-tabs__icon" />
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
      title="New tab (Alt+T)"
      @click="addTab()"
    >
      <i-mdi-plus />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.explorer-tabs {
  // Shoulder overlap. The curve is ~17px wide; space-2 on each side meets in the middle.
  --tab-overlap: var(--vgo-space-2);
  --tab-height: calc(var(--vgo-control-md) + var(--vgo-space-1));

  display: flex;
  align-items: flex-end;
  gap: 0;
  flex: 1;
  min-width: 0;
  // content-box so the 1px bottom pad sits outside --tab-height and can
  // cover the top-bar border without shortening the tabs.
  box-sizing: content-box;
  height: var(--tab-height);
  padding-bottom: 1px;
  margin-bottom: -1px;
  flex-wrap: nowrap;
  overflow: hidden;
  isolation: isolate;

  &__defs {
    position: absolute;
    width: 0;
    height: 0;
  }

  &__item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--vgo-space-1);
    // Equal share of the strip, capped like Chrome (~240px), shrinks down to a close button.
    flex: 1 1 0;
    min-width: 2.5rem;
    max-width: 15rem;
    height: 100%;
    margin-inline: calc(var(--tab-overlap) * -1);
    // Top corners only. The shoulder SVG is the silhouette; this keeps the rounded-tab contract.
    border-radius: var(--vgo-radius-lg) var(--vgo-radius-lg) 0 0;
    outline: none;
    cursor: pointer;
    font-size: var(--vgo-font-sm);
    color: var(--vgo-text-secondary);
    user-select: none;
    z-index: 1;
    container-type: inline-size;

    // First *tab* — not `:first-child`, because the geometry <svg> comes first.
    // Without this the left shoulder is pulled outside and clipped by overflow.
    &:first-of-type {
      margin-inline-start: 0;
    }

    &:hover {
      z-index: 2;
      color: var(--vgo-text);
    }

    &.is-active {
      z-index: 3;
      color: var(--vgo-text);
    }

    &:focus-visible {
      outline: 1px solid var(--vgo-primary);
      outline-offset: calc(var(--vgo-space-1) * -1);
    }

    // Two titles need room to stay readable; the cap is 1.5× a single tab.
    &.is-split {
      min-width: 10rem;
      max-width: 18rem;
    }

    &.is-drag-source {
      opacity: 0.5;
    }

    // Short separator between two background tabs. Hidden beside the active or hovered tab.
    &:not(.is-active):not(:hover) + &:not(.is-active):not(:hover)::before {
      content: '';
      position: absolute;
      z-index: 1;
      left: var(--tab-overlap);
      top: 50%;
      width: 1px;
      height: var(--vgo-font-lg);
      transform: translateY(-50%);
      background-color: var(--vgo-border);
      pointer-events: none;
    }

    &.is-drop-before::after,
    &.is-drop-after::after {
      content: '';
      position: absolute;
      z-index: 4;
      top: var(--vgo-space-1);
      bottom: 0;
      width: var(--vgo-space-1);
      background-color: var(--vgo-primary);
      pointer-events: none;
    }

    &.is-drop-before::after {
      left: 0;
    }

    &.is-drop-after::after {
      right: 0;
    }
  }

  &__shape {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    // Explicit height — SVG defaults to 150px tall if only top/bottom are set,
    // and the fill paints below the overflow clip. +1px covers the top-bar hairline.
    width: 100%;
    height: calc(100% + 1px);
    overflow: hidden;
    pointer-events: none;
    color: transparent;
    // Tokens, not a literal duration: Reduce Motion collapses --vgo-duration-*.
    transition: color var(--vgo-duration-fast);

    use {
      fill: currentColor;
    }
  }

  &__item:hover &__shape {
    color: color-mix(in srgb, var(--vgo-surface-raised) 42%, var(--explorer-tab-strip, var(--vgo-window)));
  }

  &__item.is-active &__shape {
    // Same fill as the ledge under the strip, so the tab joins the toolbar.
    color: var(--vgo-surface-raised);
    transition: none;
  }

  &__item.is-drop-pending &__shape {
    color: var(--vgo-primary-opacity);
  }

  /** One pane's slot inside an item. A single tab is just one of these. */
  &__half {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--vgo-space-1);
    flex: 1;
    min-width: 0;
    height: 100%;
    // Clear the fixed-width shoulder. The close button owns the trailing inset.
    padding-inline-start: var(--vgo-space-4);

    &:last-child {
      padding-inline-end: var(--vgo-space-4);
    }

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

    &:not(.is-focused) {
      color: var(--vgo-text-secondary);
    }
  }

  &__icon {
    flex-shrink: 0;
    font-size: var(--vgo-icon-sm);
  }

  &__label {
    flex: 1;
    min-width: 0;
    line-height: 1.4;
    text-align: start;
  }

  &__close {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    // Sit clear of the neighbour's overlapping shoulder.
    margin-inline-end: var(--vgo-space-4);

    svg {
      font-size: var(--vgo-icon-sm);
    }
  }

  &__add {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    align-self: center;
    font-size: var(--vgo-icon-sm);
    // The last tab's negative margin pulls this in; leave a small gap past the shoulder.
    margin-inline-start: var(--vgo-space-3);
  }
}

@container (max-width: 5.5rem) {
  .explorer-tabs__label {
    display: none;
  }
}

@container (max-width: 3.25rem) {
  .explorer-tabs__icon {
    display: none;
  }

  .explorer-tabs__close {
    margin-inline: auto;
  }
}
</style>
