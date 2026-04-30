<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
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
        class="nav-arrow"
        :class="{ disabled: currentIndex <= 0 }"
        title="Previous (↑ / k)"
        @click.stop="navigate(false)"
      >
        <span class="mdi mdi-chevron-up" />
      </button>
      <button
        class="nav-arrow nav-arrow--collect"
        :class="{ active: collected }"
        title="Collect (c)"
        @click.stop="handleToggleCollect"
      >
        <span class="mdi" :class="collected ? 'mdi-star' : 'mdi-star-outline'" />
      </button>
      <button
        class="nav-arrow"
        title="Locate in folder"
        @click.stop="handleLocateCurrent"
      >
        <span class="mdi mdi-crosshairs-gps" />
      </button>
      <button
        class="nav-arrow"
        :class="{ disabled: currentIndex >= items.length - 1 }"
        title="Next (↓ / j)"
        @click.stop="navigate(true)"
      >
        <span class="mdi mdi-chevron-down" />
      </button>
    </div>

    <!-- ─── Zoom toolbar (images only) ─── -->
    <Transition name="edge-fade">
      <div v-if="currentItem?.type === 'image'" class="zoom-toolbar">
        <span v-if="zoom.resolution.value" class="zoom-resolution">{{ zoom.resolution.value }}</span>
        <button class="zoom-btn" title="Zoom out (Ctrl+scroll)" @click.stop="zoom.zoomOut()">
          <span class="mdi mdi-minus" />
        </button>
        <span class="zoom-scale">{{ zoom.scalePercent.value }}</span>
        <button class="zoom-btn" title="Zoom in (Ctrl+scroll)" @click.stop="zoom.zoomIn()">
          <span class="mdi mdi-plus" />
        </button>
      </div>
    </Transition>

    <!-- ─── Collection floating button ─── -->
    <Transition name="edge-fade">
      <div v-if="hasCollection && collectedInCurrentDir.length > 0" class="collection-fab-wrap">
        <button class="collection-fab" title="Select collected" @click="handleSelectCollected">
          <span class="mdi mdi-check-decagram-outline collection-fab__bg" />
          <span class="collection-fab__count">{{ collectedInCurrentDir.length }}</span>
        </button>
        <button class="collection-fab__close" title="Clear collection" @click="clearCollection">
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
        <div class="edge-card">
          <div class="edge-card-icon">
            <span
              class="mdi"
              :class="edgeOverlay === 'end' ? 'mdi-flag-checkered' : 'mdi-flag-outline'"
            />
          </div>
          <p class="edge-card-title">
            {{ edgeOverlay === 'end' ? 'End of gallery' : 'Start of gallery' }}
          </p>
          <p class="edge-card-sub">
            {{ edgeOverlay === 'end'
              ? `${items.length} item${items.length !== 1 ? 's' : ''} shown`
              : 'Nothing before this' }}
          </p>

          <button class="edge-btn edge-btn--primary" @click="jumpToOpposite">
            <span
              class="mdi"
              :class="edgeOverlay === 'end' ? 'mdi-arrow-up-thin-circle-outline' : 'mdi-arrow-down-thin-circle-outline'"
            />
            {{ edgeOverlay === 'end' ? 'Back to beginning' : 'Jump to end' }}
          </button>

          <button class="edge-btn" disabled>
            <span
              class="mdi"
              :class="edgeOverlay === 'end' ? 'mdi-skip-next-circle-outline' : 'mdi-skip-previous-circle-outline'"
            />
            {{ edgeOverlay === 'end' ? 'Next folder' : 'Prev folder' }}
            <span class="soon-badge">Soon</span>
          </button>

          <button class="edge-btn edge-btn--ghost" @click="edgeOverlay = null">
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
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 15;
  display: flex;
  flex-direction: column;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.2s;

  .endless-gallery:hover & { opacity: 1; }

  @media screen and (max-width: 500px) {
    opacity: 1;
  }
}

.nav-arrow {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.28); }
  &:active { background: rgba(255, 255, 255, 0.38); }

  &.disabled {
    opacity: 0.25;
    cursor: default;
    pointer-events: none;
  }

  &--collect {
    font-size: 18px;

    &.active {
      color: var(--vgo-primary);
      background: rgba(var(--vgo-primary-rgb), 0.2);

      &:hover { background: rgba(var(--vgo-primary-rgb), 0.3); }
    }
  }
}

// ── Zoom toolbar ─────────────────────────────────────────────
.zoom-toolbar {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  border-radius: 20px;
  padding: 4px 8px;
  opacity: 0;
  transition: opacity 0.2s;

  .endless-gallery:hover & { opacity: 1; }

  @media screen and (max-width: 500px) {
    opacity: 1;
  }
}

.zoom-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.28); }
  &:active { background: rgba(255, 255, 255, 0.38); }
}

.zoom-scale {
  color: #fff;
  font-size: 12px;
  min-width: 38px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.zoom-resolution {
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  white-space: nowrap;
  padding-right: 4px;
  border-right: 1px solid rgba(255, 255, 255, 0.15);
  margin-right: 2px;
}

// ── Collection floating button ───────────────────────────────────
.collection-fab-wrap {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 15;
}

.collection-fab {
  position: relative;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: none;
  background: #ffffff2a;
  backdrop-filter: blur(12px);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  transition: background 0.15s, transform 0.15s;

  &:hover {
    background: #ffffff33;
    transform: scale(1.08);
  }
  &:active {
    transform: scale(0.95);
  }

  .collection-fab__bg {
    position: absolute;
    font-size: 32px;
    color: #ffffff45;
    line-height: 1;
    pointer-events: none;
  }

  .collection-fab__count {
    position: relative;
    z-index: 1;
    color: #ffffff;
    font-size: 16px;
    line-height: 1;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  }
}

.collection-fab__close {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(6px);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: rgba(255, 80, 80, 0.5);
    color: #fff;
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
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.edge-card {
  background: rgba(28, 28, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  padding: 28px 28px 20px;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);

  .edge-card-icon {
    font-size: 44px;
    color: rgba(255, 255, 255, 0.45);
    line-height: 1;
  }

  .edge-card-title {
    color: #fff;
    font-size: 17px;
    font-weight: 600;
    margin: 0;
  }

  .edge-card-sub {
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    margin: -4px 0 4px;
  }
}

.edge-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 10px 16px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
  &:active:not(:disabled) { background: rgba(255, 255, 255, 0.2); }

  &:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  &--primary {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.25);
    font-weight: 500;
    &:hover { background: rgba(255, 255, 255, 0.22); }
  }

  &--ghost {
    background: transparent;
    border-color: transparent;
    color: rgba(255, 255, 255, 0.45);
    font-size: 13px;
  }

  .soon-badge {
    font-size: 10px;
    background: rgba(255, 255, 255, 0.15);
    padding: 2px 6px;
    border-radius: 5px;
    letter-spacing: 0.3px;
  }
}

// ── Transitions ──────────────────────────────────────────────
.edge-fade-enter-active,
.edge-fade-leave-active {
  transition: opacity 0.2s ease;
  .edge-card {
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
}
.edge-fade-enter-from,
.edge-fade-leave-to {
  opacity: 0;
  .edge-card { transform: scale(0.92); }
}
</style>
