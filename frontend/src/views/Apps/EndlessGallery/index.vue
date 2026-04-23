<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
import { fsWebApi } from '@/api/filesystem.ts'
import {
  regSupportedAudioFormat,
  regSupportedImageFormat,
  regSupportedVideoFormat,
} from '@/utils/is.ts'

interface MediaFile {
  name: string
  url: string
  type: 'image' | 'video' | 'audio'
}

const props = defineProps<{ appParams: AppParams }>()
const emit = defineEmits<{
  (e: 'setTitle', val: string): void
  (e: 'exit'): void
}>()

// ── Media list ─────────────────────────────────────────────

function getMediaType(name: string): MediaFile['type'] | null {
  if (regSupportedImageFormat.test(name))
    return 'image'
  if (regSupportedVideoFormat.test(name))
    return 'video'
  if (regSupportedAudioFormat.test(name))
    return 'audio'
  return null
}

const items = ref<MediaFile[]>([])
const currentIndex = ref(0)

const folderName = computed(() => {
  const parts = (props.appParams?.basePath || '').split('/').filter(Boolean)
  return parts[parts.length - 1] || '/'
})

watch(
  () => props.appParams,
  () => {
    if (!props.appParams)
      return
    const { item, list, basePath } = props.appParams
    const result: MediaFile[] = []
    for (const i of list) {
      if (i.isDirectory)
        continue
      const type = getMediaType(i.name)
      if (!type)
        continue
      result.push({ name: i.name, url: fsWebApi.getStreamUrl(`${basePath}/${i.name}`), type })
    }
    items.value = result
    const idx = result.findIndex(i => i.name === item.name)
    currentIndex.value = Math.max(0, idx)
  },
  { immediate: true },
)

const currentItem = computed(() => items.value[currentIndex.value] ?? null)
const prevItem = computed(() => (currentIndex.value > 0 ? items.value[currentIndex.value - 1] : null))
const nextItem = computed(() =>
  currentIndex.value < items.value.length - 1 ? items.value[currentIndex.value + 1] : null,
)

watch(currentItem, (item) => {
  if (item)
    emit('setTitle', `[${currentIndex.value + 1}/${items.value.length}] ${item.name} - ${folderName.value}`)
}, { immediate: true })

// ── Swipe state ────────────────────────────────────────────

const wrapperRef = ref<HTMLElement | null>(null)
const dragOffset = ref(0)
const withTransition = ref(false)
const edgeOverlay = ref<'start' | 'end' | null>(null)

let isAnimating = false
let isDragging = false
let startY = 0

const THRESHOLD = 60
const DURATION = 260

const containerStyle = computed(() => ({
  transform: `translateY(${dragOffset.value}px)`,
  transition: withTransition.value
    ? `transform ${DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
    : 'none',
}))

function getHeight(): number {
  return wrapperRef.value?.offsetHeight ?? window.innerHeight
}

// ── Navigation ─────────────────────────────────────────────

function navigate(isNext: boolean) {
  if (isAnimating || edgeOverlay.value)
    return

  if (isNext && currentIndex.value >= items.value.length - 1) {
    edgeOverlay.value = 'end'
    snapBack()
    return
  }
  if (!isNext && currentIndex.value <= 0) {
    edgeOverlay.value = 'start'
    snapBack()
    return
  }

  isAnimating = true
  withTransition.value = true
  dragOffset.value = isNext ? -getHeight() : getHeight()

  setTimeout(() => {
    withTransition.value = false
    currentIndex.value += isNext ? 1 : -1
    dragOffset.value = 0
    nextTick(() => { isAnimating = false })
  }, DURATION)
}

function snapBack() {
  if (dragOffset.value === 0 && !isAnimating)
    return
  isAnimating = true
  withTransition.value = true
  dragOffset.value = 0
  setTimeout(() => {
    withTransition.value = false
    isAnimating = false
  }, DURATION)
}

function jumpToOpposite() {
  const isEnd = edgeOverlay.value === 'end'
  edgeOverlay.value = null
  currentIndex.value = isEnd ? 0 : items.value.length - 1
}

// ── Pointer events ─────────────────────────────────────────

function onPointerDown(e: MouseEvent | TouchEvent) {
  const target = e.target as HTMLElement
  if (target.closest('video, audio, button, input, a'))
    return
  if (isAnimating || edgeOverlay.value)
    return
  e.preventDefault()
  startY = 'touches' in e ? e.touches[0].clientY : e.clientY
  isDragging = true
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('touchmove', onPointerMove, { passive: false })
  window.addEventListener('mouseup', onPointerUp)
  window.addEventListener('touchend', onPointerUp)
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  if (!isDragging)
    return
  if ('touches' in e)
    e.preventDefault()
  const y = 'touches' in e ? e.touches[0].clientY : e.clientY
  dragOffset.value = y - startY
}

function onPointerUp() {
  if (!isDragging)
    return
  isDragging = false
  cleanListeners()
  const delta = dragOffset.value
  if (Math.abs(delta) >= THRESHOLD) {
    navigate(delta < 0)
  }
  else {
    snapBack()
  }
}

function cleanListeners() {
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('touchmove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUp)
  window.removeEventListener('touchend', onPointerUp)
}

// ── Wheel ──────────────────────────────────────────────────

function onWheel(e: WheelEvent) {
  if (isAnimating)
    return
  navigate(e.deltaY > 0)
}

// ── Keyboard ───────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (edgeOverlay.value) {
    if (e.key === 'Escape')
      edgeOverlay.value = null
    return
  }
  switch (e.key) {
    case 'ArrowDown':
    case 'PageDown':
    case 'j':
      e.preventDefault()
      navigate(true)
      break
    case 'ArrowUp':
    case 'PageUp':
    case 'k':
      e.preventDefault()
      navigate(false)
      break
    case 'Escape':
      emit('exit')
      break
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  cleanListeners()
})
</script>

<template>
  <div
    ref="wrapperRef"
    class="endless-gallery"
    @wheel.prevent="onWheel"
    @mousedown="onPointerDown"
    @touchstart="onPointerDown"
  >
    <!-- ─── Swipe container ─── -->
    <div class="swipe-container" :style="containerStyle">
      <!-- Prev panel (above) -->
      <div class="swipe-panel swipe-panel--prev">
        <template v-if="prevItem">
          <img v-if="prevItem.type === 'image'" :src="prevItem.url" class="media-fit" draggable="false">
          <video v-else-if="prevItem.type === 'video'" :src="prevItem.url" class="media-fit" />
          <div v-else class="audio-pane">
            <span class="mdi mdi-music-circle-outline audio-bg-icon" />
          </div>
        </template>
        <div v-else class="boundary-hint">
          <span class="mdi mdi-ray-start" />
        </div>
      </div>

      <!-- Current panel -->
      <div class="swipe-panel swipe-panel--current">
        <template v-if="currentItem">
          <img
            v-if="currentItem.type === 'image'"
            :src="currentItem.url"
            class="media-fit"
            draggable="false"
          >
          <video
            v-else-if="currentItem.type === 'video'"
            :key="currentItem.url"
            :src="currentItem.url"
            class="media-fit"
            controls
            autoplay
            loop
          />
          <div v-else class="audio-pane">
            <span class="mdi mdi-music-circle-outline audio-bg-icon" />
            <audio
              :key="currentItem.url"
              :src="currentItem.url"
              controls
              autoplay
              class="audio-ctrl"
              loop
            />
          </div>
        </template>
      </div>

      <!-- Next panel (below) -->
      <div class="swipe-panel swipe-panel--next">
        <template v-if="nextItem">
          <img v-if="nextItem.type === 'image'" :src="nextItem.url" class="media-fit" draggable="false">
          <video v-else-if="nextItem.type === 'video'" :src="nextItem.url" class="media-fit" />
          <div v-else class="audio-pane">
            <span class="mdi mdi-music-circle-outline audio-bg-icon" />
          </div>
        </template>
        <div v-else class="boundary-hint">
          <span class="mdi mdi-ray-end" />
        </div>
      </div>
    </div>

    <!-- ─── Navigation arrows ─── -->
    <div v-if="!edgeOverlay" class="nav-arrows">
      <button
        class="nav-arrow"
        :class="{ disabled: !prevItem }"
        title="Previous (↑ / k)"
        @click.stop="navigate(false)"
      >
        <span class="mdi mdi-chevron-up" />
      </button>
      <button
        class="nav-arrow"
        :class="{ disabled: !nextItem }"
        title="Next (↓ / j)"
        @click.stop="navigate(true)"
      >
        <span class="mdi mdi-chevron-down" />
      </button>
    </div>

    <!-- ─── Info overlay ─── -->
    <!-- <div v-if="currentItem" class="info-overlay">
      <div class="info-top">
        <span class="mdi mdi-folder-outline" />
        <span class="info-folder" :title="folderName">{{ folderName }}</span>
      </div>
      <div class="info-bottom">
        <div class="info-filename" :title="currentItem.name">
          {{ currentItem.name }}
        </div>
        <div class="info-counter">
          {{ currentIndex + 1 }}&thinsp;/&thinsp;{{ items.length }}
        </div>
      </div>
    </div> -->

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
  background: #0d0d0d;
  user-select: none;
  cursor: grab;
  touch-action: none;

  &:active { cursor: grabbing; }
}

// ── Swipe panels ────────────────────────────────────────────
.swipe-container {
  position: absolute;
  inset: 0;
}

.swipe-panel {
  position: absolute;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;

  &--prev { bottom: 100%; top: auto; }
  &--current { top: 0; }
  &--next { top: 100%; }

  // allow media controls to fire normally
  &--current {
    cursor: default;
    video, audio, button { cursor: auto; }
  }
}

// ── Media elements ──────────────────────────────────────────
.media-fit {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none; // drag-safe for images; video inherits from parent
}

.swipe-panel--current .media-fit {
  pointer-events: auto; // restore for video controls
}

// ── Audio pane ──────────────────────────────────────────────
.audio-pane {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;

  .audio-bg-icon {
    font-size: 120px;
    color: rgba(255, 255, 255, 0.12);
    pointer-events: none;
  }

  .audio-ctrl {
    width: min(85%, 420px);
  }
}

// ── Boundary hint shown when prev/next is null ───────────────
.boundary-hint {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  color: rgba(255, 255, 255, 0.1);
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
  // background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55) 0%, transparent 100%);
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
  // background: linear-gradient(to top, rgba(0, 0, 0, 0.65) 0%, transparent 100%);
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
