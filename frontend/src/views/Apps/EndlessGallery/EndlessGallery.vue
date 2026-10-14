<script lang="ts" setup>
import type { WalkDirection } from './folder-nav/tree-walk.ts'
import type { AppParams } from '@/views/Apps/apps.ts'
import { injectShortcutScope, useShortcut } from '@/hooks/use-shortcut'
import { createTask, onTaskDone } from '@/store/tasks'
import { confirmDeleteDialog } from '@/utils/delete-confirm'
import { joinPath, normalizePath } from '@/utils/path/form'
import { useFolderNavigation } from './folder-nav/use-folder-navigation.ts'
import GalleryPanels from './GalleryPanels.vue'
import GalleryThumbStrip from './GalleryThumbStrip.vue'
import { useCollection } from './use-collection.ts'
import { useGalleryPanels } from './use-gallery-panels.ts'
import { useMediaList } from './use-media-list.ts'
import { useSwipe } from './use-swipe.ts'
import { useZoom } from './use-zoom.ts'

const props = defineProps<{ appParams: AppParams }>()
const emit = defineEmits<{
  (e: 'setTitle', val: string): void
  (e: 'exit'): void
  (e: 'selectItems', names: string[]): void
  (e: 'locateItem', name: string): void
  (e: 'updateAppParams', params: AppParams): void
}>()

const edgeOverlayRef = ref<HTMLElement | null>(null)

/** 底部缩略图条是否收起：收起后主内容区占满整高（运行时状态，不跨窗口持久化） */
const stripCollapsed = ref(false)

// ── Collection ─────────────────────────────────────────────

const { collection, collectedPathSet, getCollectedInDirectory, toggleCollect, clearCollection, pruneDirectory } = useCollection()

// ── Media list ─────────────────────────────────────────────

const { items, currentIndex, currentItem, folderName, removeItem }
  = useMediaList(() => props.appParams, pruneDirectory)

watch(currentItem, (item) => {
  if (item) {
    emit('setTitle', `[${currentIndex.value + 1}/${items.value.length}] ${item.name} - ${folderName.value}`)
    return
  }
  // Nothing left to show: an empty folder, or the last item was just deleted
  emit('setTitle', folderName.value)
}, { immediate: true })

// ── Collection computed ─────────────────────────────────────

const currentAbsPath = computed(() => {
  if (!props.appParams?.basePath || !currentItem.value)
    return ''
  return normalizePath(joinPath(props.appParams.basePath, currentItem.value.name))
})

const collected = computed(() =>
  !!currentAbsPath.value && collectedPathSet.value.has(currentAbsPath.value),
)

const hasCollection = computed(() => collection.value.length > 0)

const collectedInCurrentDir = computed(() =>
  getCollectedInDirectory(props.appParams?.basePath ?? ''),
)

function handleToggleCollect(): void {
  if (!currentAbsPath.value || !currentItem.value)
    return
  toggleCollect({
    name: currentItem.value.name,
    basePath: props.appParams.basePath,
    absPath: currentAbsPath.value,
  })
}

function handleSelectCollected(): void {
  const collectedItems = collectedInCurrentDir.value
  if (!collectedItems.length)
    return
  emit('selectItems', collectedItems.map(i => i.name))
  emit('exit')
}

function handleLocateCurrent(): void {
  if (!currentItem.value)
    return
  emit('locateItem', currentItem.value.name)
  emit('exit')
}

// ── Delete ─────────────────────────────────────────────────

/** Guards against a second Del press while the dialog or the delete task is in flight. */
let deleting = false

/**
 * Delete the current file and land on the neighbour the user was heading towards: browsing
 * forward keeps the index (the following item shifts into place), browsing backward steps
 * back one. The local list is only updated once the server reports the file as deleted, so
 * a failed delete leaves the item on screen and the failure panel explains why.
 */
async function handleDeleteCurrent(): Promise<void> {
  const item = currentItem.value
  const absPath = currentAbsPath.value
  if (!item || !absPath || deleting)
    return

  deleting = true
  // The direction at the moment of the delete is the intent; the user may browse on while
  // the task runs.
  const direction = lastDirection.value
  try {
    if (!(await confirmDeleteDialog([{ name: item.name, isDirectory: false }]))) {
      deleting = false
      return
    }

    const taskId = await createTask({ kind: 'delete', fromPaths: [absPath] })
    onTaskDone(taskId, (task, results) => {
      deleting = false
      const deleted = task.state === 'succeeded'
        || results.some(result => result.fromPath === absPath && result.status === 'deleted')
      if (deleted)
        showNeighbourAfterDelete(item.name, direction)
    })
  }
  catch (error: any) {
    deleting = false
    window.$message?.error(error?.message || $t('file_lite_i18n.failed_to_start_the_task'))
  }
}

/**
 * Drop a deleted name from the local list and switch to the neighbouring item.
 *
 * If the user browsed away while the delete was running, they stay on what they are looking
 * at (re-found by name) instead of being pulled back to the deleted slot.
 */
function showNeighbourAfterDelete(name: string, direction: number): void {
  const keepName = currentItem.value && currentItem.value.name !== name
    ? currentItem.value.name
    : null

  const index = removeItem(name)
  if (index < 0)
    return

  // The slot at this index holds another file now, so a zoom kept from the deleted one
  // would be wrong; `watch(currentIndex)` misses the case where the index itself stays put.
  zoom.resetZoom()
  pruneDirectory(props.appParams?.basePath ?? '', new Set(items.value.map(item => item.name)))

  if (keepName) {
    const stillThere = items.value.findIndex(item => item.name === keepName)
    if (stillThere >= 0) {
      currentIndex.value = stillThere
      return
    }
  }

  // Forward: the next item moved into this index. Backward: step back to the previous one.
  // An empty list leaves the index at 0 with no current item, which shows the empty state.
  const target = direction >= 0 ? index : index - 1
  currentIndex.value = items.value.length
    ? Math.min(Math.max(target, 0), items.value.length - 1)
    : 0
}

// ── Zoom ───────────────────────────────────────────────────

const zoomViewportRef = ref<HTMLElement | null>(null)
const zoom = useZoom(
  () => currentItem.value?.type === 'image',
  () => zoomViewportRef.value?.getBoundingClientRect(),
)

watch(currentIndex, zoom.resetZoom)

const {
  panelItems,
  panelLoadedUrls,
  currentSlot,
  onPanelImageLoad,
  syncCurrentImageResolution,
  onAfterNavigate,
  onAfterJump,
} = useGalleryPanels({
  items,
  currentIndex,
  currentItem,
  zoom,
})

// ── Swipe / navigation ─────────────────────────────────────

const { wrapperRef, swipeContainerRef, containerStyle, edgeOverlay, lastDirection, navigate, jumpToOpposite, jumpToIndex, onPointerDown, onWheel }
  = useSwipe({
    items,
    currentIndex,
    zoom,
    onAfterNavigate,
    onAfterJump,
  })

// 方向键 / Esc（关 overlay）由 use-swipe 注册；收藏键与删除键在这里补上
const shortcutScope = injectShortcutScope()

useShortcut({
  scope: shortcutScope,
  combo: 'c',
  description: 'Toggle favourite',
  handler: () => {
    if (!edgeOverlay.value)
      handleToggleCollect()
  },
})

useShortcut({
  scope: shortcutScope,
  combo: 'delete',
  description: 'Delete media',
  disabled: computed(() => edgeOverlay.value != null || !currentItem.value),
  handler: () => {
    void handleDeleteCurrent()
  },
})

// ── Folder navigation ──────────────────────────────────────

const { isScanning, navigateFolder, cancelScan } = useFolderNavigation(() => props.appParams)

// 关闭 overlay（Dismiss / Esc / 点击遮罩）即放弃扫描
watch(edgeOverlay, (val) => {
  if (!val) {
    cancelScan()
    return
  }

  nextTick(() => {
    getEdgeOverlayFocusableButtons()[0]?.focus()
  })
})

function getEdgeOverlayFocusableButtons(): HTMLButtonElement[] {
  if (!edgeOverlayRef.value)
    return []
  return Array.from(edgeOverlayRef.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
}

function handleEdgeOverlayTab(e: KeyboardEvent): void {
  const buttons = getEdgeOverlayFocusableButtons()
  if (!buttons.length)
    return

  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  const active = document.activeElement

  if (!edgeOverlayRef.value?.contains(active)) {
    e.preventDefault()
    first.focus()
    return
  }

  if (active === last) {
    e.preventDefault()
    first.focus()
  }
}

/**
 * 方向键在浮层按钮之间移动焦点：按钮竖排，Up/Left 上一个、Down/Right 下一个，首尾循环。
 *
 * 模板上挂了 `.prevent`，所以浮层打开时事件会带 defaultPrevented，
 * use-shortcut 的全局方向键（翻图）会被跳过；`navigate` 本身也已经对浮层开了短路。
 */
function handleEdgeOverlayArrow(e: KeyboardEvent): void {
  const buttons = getEdgeOverlayFocusableButtons()
  if (buttons.length < 2)
    return

  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
  const next = index < 0 ? 0 : (index + (forward ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}

async function handleFolderNav(direction: WalkDirection): Promise<void> {
  const nextParams = await navigateFolder(direction)
  // overlay 已被关闭则放弃本次结果
  if (!nextParams || !edgeOverlay.value)
    return

  emit('updateAppParams', nextParams)
  edgeOverlay.value = null
  // 新旧索引相同时 watch(currentIndex) 不触发，这里显式重置
  zoom.resetZoom()
}

function setSwipeContainerRef(el: HTMLElement | null): void {
  swipeContainerRef.value = el
}

function setWrapperRef(el: unknown): void {
  const element = el instanceof HTMLElement ? el : null
  wrapperRef.value = element
  zoomViewportRef.value = element
}
</script>

<template>
  <div
    class="endless-gallery"
    @wheel.prevent="onWheel"
    @mousedown="onPointerDown"
    @touchstart="onPointerDown"
    @contextmenu.prevent
  >
    <!-- 主内容区：媒体 + 悬浮控件。缩略图条是它下面独立的一行，不再压在画面上 -->
    <div :ref="setWrapperRef" class="gallery-main">
      <GalleryPanels
        :panel-items="panelItems"
        :panel-loaded-urls="panelLoadedUrls"
        :current-slot="currentSlot"
        :container-style="containerStyle"
        :current-image-style="zoom.imageStyle.value"
        @container-ready="setSwipeContainerRef"
        @image-load="onPanelImageLoad"
        @current-image-ready="syncCurrentImageResolution"
      />

      <!-- ─── Navigation arrows ─── -->
      <div v-if="!edgeOverlay && items.length" class="nav-arrows">
        <button
          class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg"
          :title="`${$t('file_lite_i18n.previous')} (↑ / ← / k)`"
          @click.stop="navigate(false, { instant: true })"
          @contextmenu.prevent="jumpToIndex(0)"
        >
          <i-mdi-chevron-up />
        </button>
        <button
          class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg nav-collect"
          :class="{ 'is-active': collected }"
          :title="`${$t('file_lite_i18n.collect')} (c)`"
          @click.stop="handleToggleCollect"
        >
          <MdiIcon :name="collected ? 'star' : 'star-outline'" />
        </button>
        <button
          class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg"
          :title="$t('file_lite_i18n.locate_in_folder')"
          @click.stop="handleLocateCurrent"
        >
          <i-mdi-crosshairs-gps />
        </button>
        <button
          class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg nav-delete"
          :title="`${$t('file_lite_i18n.delete')} (Del)`"
          @click.stop="handleDeleteCurrent"
        >
          <i-mdi-delete-outline />
        </button>
        <button
          class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg"
          :title="`${$t('file_lite_i18n.next')} (↓ / → / j)`"
          @click.stop="navigate(true, { instant: true })"
          @contextmenu.prevent="jumpToIndex(items.length - 1)"
        >
          <i-mdi-chevron-down />
        </button>
      </div>

      <!-- ─── Zoom toolbar (images only) ─── -->
      <Transition name="edge-fade">
        <div v-if="currentItem?.type === 'image'" class="zoom-toolbar vgo-panel vgo-panel--overlay">
          <span v-if="zoom.resolution.value" class="zoom-resolution">{{ zoom.resolution.value }}</span>
          <button
            class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--sm"
            :title="`${$t('file_lite_i18n.zoom_out')} (Ctrl+scroll / right button+scroll)`"
            @click.stop="zoom.zoomOut()"
          >
            <i-mdi-minus />
          </button>
          <button
            class="vgo-u-button-reset zoom-scale"
            :title="$t('file_lite_i18n.reset_zoom')"
            @click.stop="zoom.resetZoom()"
          >
            {{ zoom.scalePercent.value }}
          </button>
          <button
            class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--sm"
            :title="`${$t('file_lite_i18n.zoom_in')} (Ctrl+scroll / right button+scroll)`"
            @click.stop="zoom.zoomIn()"
          >
            <i-mdi-plus />
          </button>
        </div>
      </Transition>

      <!-- ─── Collection floating button ─── -->
      <Transition name="edge-fade">
        <div v-if="hasCollection && collectedInCurrentDir.length > 0" class="collection-fab-wrap">
          <button
            class="vgo-button vgo-button--overlay vgo-button--round vgo-button--lg collection-fab"
            :title="$t('file_lite_i18n.select')"
            @click="handleSelectCollected"
          >
            <span class="collection-fab__count">{{ collectedInCurrentDir.length }}</span>
          </button>
          <button
            class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--sm collection-fab__close"
            :title="$t('file_lite_i18n.clear')"
            @click="clearCollection"
          >
            <i-mdi-close />
          </button>
        </div>
      </Transition>

      <!-- ─── Empty state ─── -->
      <div v-if="!items.length" class="empty-state">
        <i-mdi-image-off-outline />
        <span>{{ $t('file_lite_i18n.no_media') }}</span>
      </div>
    </div>

    <!-- ─── Thumbnail strip：独立一行，可收起。mini 按钮贴条顶边水平居中，遵循 hover 显隐 ─── -->
    <div v-if="items.length" class="gallery-strip-wrap" :class="{ 'is-collapsed': stripCollapsed }">
      <button
        class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--sm strip-toggle"
        :title="stripCollapsed ? $t('file_lite_i18n.show') : $t('file_lite_i18n.hide')"
        :aria-expanded="!stripCollapsed"
        @click.stop="stripCollapsed = !stripCollapsed"
      >
        <i-mdi-chevron-up v-if="stripCollapsed" />
        <i-mdi-chevron-down v-else />
      </button>
      <div class="gallery-strip">
        <div class="gallery-strip__inner">
          <GalleryThumbStrip
            :items="items"
            :current-index="currentIndex"
            :base-path="appParams.basePath"
            @select="jumpToIndex"
          />
        </div>
      </div>
    </div>

    <!-- ─── Edge overlay ─── -->
    <Transition name="edge-fade">
      <div
        v-if="edgeOverlay"
        ref="edgeOverlayRef"
        class="edge-overlay"
        role="dialog"
        aria-modal="true"
        @click.self="edgeOverlay = null"
        @keydown.tab.exact="handleEdgeOverlayTab"
        @keydown.up.down.left.right.prevent="handleEdgeOverlayArrow"
      >
        <div class="edge-card vgo-panel vgo-panel--overlay vgo-empty">
          <MdiIcon
            class="vgo-empty__icon"
            :name="edgeOverlay === 'end' ? 'flag-checkered' : 'flag-outline'"
          />
          <p class="vgo-empty__title">
            {{ edgeOverlay === 'end' ? 'End of gallery' : 'Start of gallery' }}
          </p>
          <p class="vgo-empty__desc">
            {{ edgeOverlay === 'end'
              ? `${items.length} item${items.length !== 1 ? 's' : ''} shown`
              : 'Nothing before this' }}
          </p>

          <button class="vgo-button vgo-button--overlay edge-btn is-emphasis" :disabled="isScanning" @click="jumpToOpposite">
            <MdiIcon
              :name="edgeOverlay === 'end' ? 'arrow-up-thin-circle-outline' : 'arrow-down-thin-circle-outline'"
            />
            {{ edgeOverlay === 'end' ? 'Back to beginning' : 'Jump to end' }}
          </button>

          <button
            class="vgo-button vgo-button--overlay edge-btn"
            :disabled="isScanning"
            @click="handleFolderNav(edgeOverlay === 'end' ? 'next' : 'prev')"
          >
            <i-mdi-loading v-if="isScanning" class="icon-spin" />
            <MdiIcon
              v-else
              :name="edgeOverlay === 'end' ? 'skip-next-circle-outline' : 'skip-previous-circle-outline'"
            />
            <template v-if="isScanning">
              {{ $t('file_lite_i18n.scanning') }}…
            </template>
            <template v-else>
              {{ edgeOverlay === 'end' ? 'Next folder' : 'Prev folder' }}
            </template>
          </button>

          <button class="vgo-button vgo-button--overlay vgo-button--text edge-btn" @click="edgeOverlay = null">
            <i-mdi-close /> {{ $t('file_lite_i18n.close') }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss" scoped>
// ── Root ────────────────────────────────────────────────────
// 纵向两行：主内容区（媒体 + 悬浮控件）在上，缩略图条在下。缩略图条不叠在画面上。
.endless-gallery {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  // 透明底的棋盘格：亮色主题用接近白的浅灰，暗色主题用深灰（跟随 html.dark）
  --gallery-grid-base: #ffffff;
  --gallery-grid-check: #f0f0f0;

  background-color: var(--gallery-grid-base);
  background-image: conic-gradient(
    var(--gallery-grid-check) 25%,
    var(--gallery-grid-base) 0 50%,
    var(--gallery-grid-check) 0 75%,
    var(--gallery-grid-base) 0
  );
  background-size: 24px 24px;
  user-select: none;
  touch-action: none;

  html.dark & {
    --gallery-grid-base: #0d0d0d;
    --gallery-grid-check: #181818;
  }
}

// 主内容区：媒体铺满这一块，导航 / 缩放 / 收藏浮层都相对它定位。
// `getHeight()`（翻页位移）与缩放视口也读它，所以它必须恰好是可见媒体区，不含缩略图条。
.gallery-main {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  // 裁掉相邻面板：不裁的话下一张会在翻页时盖到下面的缩略图条上
  overflow: hidden;
}

// ── Overlay palette ──────────────────────────────────────────
// 浮层控件与面板共用一套配色，随主题切换：亮色主题「浅底深字」，暗色主题「深底浅字」。
//
// vgo-ui 的两套浮层配色（--overlay / --overlay-light）**故意不随主题翻转**：库的角度是
// 「看底下媒体的明暗」选一套，而画廊底下既有任意亮度的图片、也有跟随主题的棋盘格，
// 所以由画廊按主题选一套挂在根上，子树（缩略图条、缩放工具条、按钮）全部继承 ——
// 只是换令牌，不需要改 vgo-ui。亮色那一套就是库里的 --overlay-light 原值。
.endless-gallery {
  --vgo-overlay-surface: rgba(255, 255, 255, 0.62);
  --vgo-overlay-border: rgba(0, 0, 0, 0.12);
  --vgo-overlay-text: #171717;
  --vgo-overlay-text-secondary: rgba(23, 23, 23, 0.6);
  --vgo-overlay-control: rgba(0, 0, 0, 0.06);
  --vgo-overlay-control-hover: rgba(0, 0, 0, 0.14);
  --vgo-overlay-control-active: rgba(0, 0, 0, 0.05);

  html.dark & {
    --vgo-overlay-surface: rgba(0, 0, 0, 0.45);
    --vgo-overlay-border: rgba(255, 255, 255, 0.16);
    --vgo-overlay-text: #ffffff;
    --vgo-overlay-text-secondary: rgba(255, 255, 255, 0.55);
    --vgo-overlay-control: rgba(255, 255, 255, 0.14);
    --vgo-overlay-control-hover: rgba(255, 255, 255, 0.26);
    --vgo-overlay-control-active: rgba(255, 255, 255, 0.18);
  }
}

// 独立药丸按钮（导航 / 收藏 / 缩略图条把手）用**整块白色填充**，而不是继承面板里那种淡染控件
// （rgba(0, 0, 0, .06)）：淡染是给压在半透明浅色面板上的控件用的，药丸直接浮在
// 暗色照片上时深色图标会看不见。白底 + 深色图标对任意亮度的图片都成立。
.nav-arrows,
.collection-fab-wrap,
.strip-toggle {
  --vgo-overlay-control: rgba(255, 255, 255, 0.75);
  --vgo-overlay-control-hover: rgba(255, 255, 255, 0.92);
  --vgo-overlay-control-active: rgba(0, 0, 0, 0.12);

  html.dark & {
    --vgo-overlay-control: rgba(0, 0, 0, 0.45);
    --vgo-overlay-control-hover: rgba(0, 0, 0, 0.62);
    --vgo-overlay-control-active: rgba(0, 0, 0, 0.78);
  }
}

// 起止浮层是压暗后面内容的遮罩，保持深色一套，不跟主题
.edge-overlay {
  --vgo-overlay-surface: rgba(0, 0, 0, 0.45);
  --vgo-overlay-border: rgba(255, 255, 255, 0.16);
  --vgo-overlay-text: #ffffff;
  --vgo-overlay-text-secondary: rgba(255, 255, 255, 0.55);
  --vgo-overlay-control: rgba(255, 255, 255, 0.14);
  --vgo-overlay-control-hover: rgba(255, 255, 255, 0.26);
  --vgo-overlay-control-active: rgba(255, 255, 255, 0.38);
}

// ── Navigation arrows ────────────────────────────────────────
.nav-arrows {
  position: absolute;
  right: var(--vgo-space-3);
  top: 50%;
  transform: translateY(-50%);
  z-index: 15;
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-2);
  opacity: 0;
  transition: opacity var(--vgo-duration-base);

  .endless-gallery:hover & { opacity: 1; }

  @media screen and (max-width: 500px) {
    opacity: 1;
  }
}

// 收藏态的配色由 .vgo-button.is-active 给，深色浮层上再补一圈描边加强对比
.nav-collect.is-active {
  border-color: var(--vgo-primary);
}

// 删除不可逆：悬停给危险色提示，和左下角收藏浮层的关闭按钮同一套反馈
.nav-delete:hover {
  background-color: var(--vgo-danger);
  border-color: var(--vgo-danger);
}

// ── Thumbnail strip ──────────────────────────────────────────
// 主内容区下面独立的一行：不进 absolute，所以不会盖住画面。收起时只把内容高度收到 0，
// 主内容区随之占满（grid-template-rows 1fr → 0fr 可以按内容自然高度做动画，不必写死条高）。
.gallery-strip-wrap {
  position: relative;
  flex: 0 0 auto;
  z-index: 15;
}

.gallery-strip {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--vgo-duration-base) ease;
}

.gallery-strip-wrap.is-collapsed .gallery-strip {
  grid-template-rows: 0fr;
}

.gallery-strip__inner {
  min-height: 0;
  overflow: hidden;
}

// 收起 / 展开把手：mini 圆按钮，贴在缩略图条顶边水平居中（一半压在条上）。
// 显隐沿用先前的节奏：悬停淡入，窄屏常显。
.strip-toggle {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translate(-50%, -50%);
  z-index: 16;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--vgo-duration-base),
    transform var(--vgo-duration-base);

  .endless-gallery:hover & {
    opacity: 1;
    pointer-events: auto;
  }

  @media screen and (max-width: 500px) {
    opacity: 1;
    pointer-events: auto;
  }

  // 收起后条高为 0，把手整个退回媒体区底边之上，不会被画廊的 overflow 切掉
  .gallery-strip-wrap.is-collapsed & {
    transform: translate(-50%, -70%);
  }
}

// ── Zoom toolbar ─────────────────────────────────────────────
.zoom-toolbar {
  // 浮层面板：底色与内部圆按钮的淡染都来自根上那套 --vgo-overlay-* 令牌，
  // 亮色主题下自动变成「白底 + 深色淡染按钮」。
  position: absolute;
  right: var(--vgo-space-3);
  bottom: var(--vgo-space-3);
  z-index: 15;
  display: flex;
  align-items: center;
  gap: var(--vgo-space-1);
  border-radius: var(--vgo-radius-pill);
  padding: var(--vgo-space-1) var(--vgo-space-1) var(--vgo-space-1) var(--vgo-space-2);
  opacity: 0;
  transition: opacity var(--vgo-duration-base);

  .endless-gallery:hover & { opacity: 1; }

  @media screen and (max-width: 500px) {
    opacity: 1;
  }
}

.zoom-scale {
  min-width: 42px;
  font-size: var(--vgo-font-sm);
  text-align: center;
  font-variant-numeric: tabular-nums;

  &:hover {
    color: var(--vgo-primary);
  }
}

.zoom-resolution {
  color: var(--vgo-overlay-text-secondary);
  font-size: var(--vgo-font-sm);
  white-space: nowrap;
  padding-right: var(--vgo-space-1);
  border-right: 1px solid var(--vgo-overlay-border);
}

// ── Collection floating button ───────────────────────────────────
.collection-fab-wrap {
  position: absolute;
  left: var(--vgo-space-4);
  bottom: var(--vgo-space-4);
  z-index: 15;
}

.collection-fab {
  position: relative;

  .collection-fab__count {
    position: relative;
    z-index: 1;
    font-size: var(--vgo-font-lg);
    line-height: 1;
    font-weight: bold;
  }
}

.collection-fab__close {
  position: absolute;
  top: calc(var(--vgo-space-2) * -1);
  right: calc(var(--vgo-space-2) * -1);

  &:not(:disabled):hover {
    background-color: var(--vgo-danger);
    border-color: var(--vgo-danger);
  }
}

// ── Info overlay ─────────────────────────────────────────────
.info-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}

.info-top {
  padding: 12px 14px 40px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);

  .info-folder {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.info-bottom {
  padding: 40px 14px 14px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;

  .info-filename {
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .info-counter {
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
    white-space: nowrap;
    flex-shrink: 0;
  }
}

// ── Empty state ──────────────────────────────────────────────
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 14px;

  > svg { font-size: 56px; }
}

// ── Edge overlay ─────────────────────────────────────────────
.edge-overlay {
  position: absolute;
  inset: 0;
  background: var(--vgo-overlay-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--vgo-z-overlay);
}

// 结构与配色都来自 vgo-empty + vgo-panel--overlay，这里只给宽度和按钮间距
.edge-card {
  min-width: 260px;
  border-radius: var(--vgo-radius-lg);
  box-shadow: var(--vgo-shadow);
  p {
    margin: 0;
  }
}

.edge-btn {
  width: 100%;
  height: var(--vgo-control-lg);
  border-radius: var(--vgo-radius-lg);

  &.is-emphasis {
    font-weight: 500;
    background-color: var(--vgo-overlay-control-hover);
  }
}

// ── Transitions ──────────────────────────────────────────────
.edge-fade-enter-active,
.edge-fade-leave-active {
  transition: opacity var(--vgo-duration-base) ease;
  .edge-card {
    transition: transform var(--vgo-duration-base) cubic-bezier(0.34, 1.56, 0.64, 1);
  }
}
.edge-fade-enter-from,
.edge-fade-leave-to {
  opacity: 0;
  .edge-card { transform: scale(0.92); }
}
</style>
