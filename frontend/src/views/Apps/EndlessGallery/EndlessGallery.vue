<script lang="ts" setup>
import type { WalkDirection } from './folder-nav/tree-walk.ts'
import type { AppParams } from '@/views/Apps/apps.ts'
import { useFolderNavigation } from './folder-nav/use-folder-navigation.ts'
import GalleryPanels from './GalleryPanels.vue'
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

// ── Collection ─────────────────────────────────────────────

const { collection, collectedPathSet, getCollectedInDirectory, toggleCollect, clearCollection, pruneDirectory } = useCollection()

// ── Media list ─────────────────────────────────────────────

const { items, currentIndex, currentItem, folderName }
  = useMediaList(() => props.appParams, pruneDirectory)

watch(currentItem, (item) => {
  if (item)
    emit('setTitle', `[${currentIndex.value + 1}/${items.value.length}] ${item.name} - ${folderName.value}`)
}, { immediate: true })

// ── Collection computed ─────────────────────────────────────

const currentAbsPath = computed(() => {
  if (!props.appParams?.basePath || !currentItem.value)
    return ''
  return `${props.appParams.basePath}/${currentItem.value.name}`
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

const { wrapperRef, swipeContainerRef, containerStyle, edgeOverlay, navigate, jumpToOpposite, onPointerDown, onWheel }
  = useSwipe({
    items,
    currentIndex,
    zoom,
    onDoubleTap: handleToggleCollect,
    onExit: () => emit('exit'),
    onAfterNavigate,
    onAfterJump,
  })

// ── Folder navigation ──────────────────────────────────────

const { isScanning, navigateFolder, cancelScan } = useFolderNavigation(() => props.appParams)

// 关闭 overlay（Dismiss / Esc / 点击遮罩）即放弃扫描
watch(edgeOverlay, (val) => {
  if (!val)
    cancelScan()
})

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
    :ref="setWrapperRef"
    class="endless-gallery"
    @dblclick="handleToggleCollect"
    @wheel.prevent="onWheel"
    @mousedown="onPointerDown"
    @touchstart="onPointerDown"
  >
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
    <div v-if="!edgeOverlay" class="nav-arrows">
      <button
        class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg"
        :disabled="currentIndex <= 0"
        title="Previous (↑ / k)"
        @click.stop="navigate(false)"
      >
        <span class="mdi mdi-chevron-up" />
      </button>
      <button
        class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg nav-collect"
        :class="{ 'is-active': collected }"
        title="Collect (c)"
        @click.stop="handleToggleCollect"
      >
        <span class="mdi" :class="collected ? 'mdi-star' : 'mdi-star-outline'" />
      </button>
      <button
        class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg"
        title="Locate in folder"
        @click.stop="handleLocateCurrent"
      >
        <span class="mdi mdi-crosshairs-gps" />
      </button>
      <button
        class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--lg"
        :disabled="currentIndex >= items.length - 1"
        title="Next (↓ / j)"
        @click.stop="navigate(true)"
      >
        <span class="mdi mdi-chevron-down" />
      </button>
    </div>

    <!-- ─── Zoom toolbar (images only) ─── -->
    <Transition name="edge-fade">
      <div v-if="currentItem?.type === 'image'" class="zoom-toolbar vgo-panel vgo-panel--overlay">
        <span v-if="zoom.resolution.value" class="zoom-resolution">{{ zoom.resolution.value }}</span>
        <button
          class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--sm"
          title="Zoom out (Ctrl+scroll)"
          @click.stop="zoom.zoomOut()"
        >
          <span class="mdi mdi-minus" />
        </button>
        <span class="zoom-scale">{{ zoom.scalePercent.value }}</span>
        <button
          class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--sm"
          title="Zoom in (Ctrl+scroll)"
          @click.stop="zoom.zoomIn()"
        >
          <span class="mdi mdi-plus" />
        </button>
      </div>
    </Transition>

    <!-- ─── Collection floating button ─── -->
    <Transition name="edge-fade">
      <div v-if="hasCollection && collectedInCurrentDir.length > 0" class="collection-fab-wrap">
        <button
          class="vgo-button vgo-button--overlay vgo-button--round vgo-button--lg collection-fab"
          title="Select collected"
          @click="handleSelectCollected"
        >
          <span class="mdi mdi-check-decagram-outline collection-fab__bg" />
          <span class="collection-fab__count">{{ collectedInCurrentDir.length }}</span>
        </button>
        <button
          class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--sm collection-fab__close"
          title="Clear collection"
          @click="clearCollection"
        >
          <span class="mdi mdi-close" />
        </button>
      </div>
    </Transition>

    <!-- ─── Empty state ─── -->
    <div v-if="!items.length" class="empty-state">
      <span class="mdi mdi-image-off-outline" />
      <span>No media files in this folder</span>
    </div>

    <!-- ─── Edge overlay ─── -->
    <Transition name="edge-fade">
      <div v-if="edgeOverlay" class="edge-overlay" @click.self="edgeOverlay = null">
        <div class="edge-card vgo-panel vgo-panel--overlay vgo-empty">
          <span
            class="vgo-empty__icon mdi"
            :class="edgeOverlay === 'end' ? 'mdi-flag-checkered' : 'mdi-flag-outline'"
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
            <span
              class="mdi"
              :class="edgeOverlay === 'end' ? 'mdi-arrow-up-thin-circle-outline' : 'mdi-arrow-down-thin-circle-outline'"
            />
            {{ edgeOverlay === 'end' ? 'Back to beginning' : 'Jump to end' }}
          </button>

          <button
            class="vgo-button vgo-button--overlay edge-btn"
            :disabled="isScanning"
            @click="handleFolderNav(edgeOverlay === 'end' ? 'next' : 'prev')"
          >
            <span v-if="isScanning" class="mdi mdi-loading mdi-spin" />
            <span
              v-else
              class="mdi"
              :class="edgeOverlay === 'end' ? 'mdi-skip-next-circle-outline' : 'mdi-skip-previous-circle-outline'"
            />
            <template v-if="isScanning">
              Scanning…
            </template>
            <template v-else>
              {{ edgeOverlay === 'end' ? 'Next folder' : 'Prev folder' }}
            </template>
          </button>

          <button class="vgo-button vgo-button--overlay vgo-button--text edge-btn" @click="edgeOverlay = null">
            <span class="mdi mdi-close" />
            Dismiss
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss" scoped>
// ── Root ────────────────────────────────────────────────────
.endless-gallery {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background-color: #0d0d0d;
  background-image: conic-gradient(#181818 25%, #0d0d0d 0 50%, #181818 0 75%, #0d0d0d 0);
  background-size: 24px 24px;
  user-select: none;
  cursor: grab;
  touch-action: none;

  &:active { cursor: grabbing; }
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

// ── Zoom toolbar ─────────────────────────────────────────────
.zoom-toolbar {
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

  .collection-fab__bg {
    position: absolute;
    font-size: 32px;
    color: var(--vgo-overlay-control-active);
    line-height: 1;
    pointer-events: none;
  }

  .collection-fab__count {
    position: relative;
    z-index: 1;
    font-size: var(--vgo-font-lg);
    line-height: 1;
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

  .mdi { font-size: 56px; }
}

// ── Edge overlay ─────────────────────────────────────────────
.edge-overlay {
  position: absolute;
  inset: 0;
  background: var(--vgo-overlay-surface);
  backdrop-filter: blur(var(--vgo-overlay-blur));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--vgo-z-overlay);
}

// 结构与配色都来自 vgo-empty + vgo-panel--overlay，这里只给宽度和按钮间距
.edge-card {
  min-width: 260px;
  border-radius: var(--vgo-radius-lg);

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
