<script lang="ts" setup>
import type { ComponentPublicInstance, CSSProperties } from 'vue'
import type { MediaFile } from './use-media-list.ts'

const props = defineProps<{
  panelItems: (MediaFile | null)[]
  panelLoadedUrls: string[]
  currentSlot: number
  containerStyle: CSSProperties
  currentImageStyle: CSSProperties
}>()

const emit = defineEmits<{
  (e: 'containerReady', el: HTMLElement | null): void
  (e: 'imageLoad', event: Event, slotIdx: number): void
  (e: 'currentImageReady', img: HTMLImageElement): void
}>()

const containerRef = ref<HTMLElement | null>(null)
const imageRefs = ref<(HTMLImageElement | null)[]>([])
const mediaRefs = ref<(HTMLMediaElement | null)[]>([null, null, null])
const hasUserInteracted = ref(false)

function setImageRef(el: Element | ComponentPublicInstance | null, slotIdx: number): void {
  imageRefs.value[slotIdx] = el instanceof HTMLImageElement ? el : null
}

function setMediaRef(el: Element | ComponentPublicInstance | null, slotIdx: number): void {
  mediaRefs.value[slotIdx] = el instanceof HTMLMediaElement ? el : null
}

function getCurrentMedia(): HTMLMediaElement | null {
  return mediaRefs.value[props.currentSlot] ?? null
}

function pauseNonCurrentMedia(): void {
  mediaRefs.value.forEach((media, slotIdx) => {
    if (media && slotIdx !== props.currentSlot)
      media.pause()
  })
}

function playCurrentMedia(): void {
  const media = getCurrentMedia()
  if (!media)
    return

  if (hasUserInteracted.value)
    media.muted = false

  if (hasUserInteracted.value || media.muted)
    media.play().catch(() => {})
}

async function syncMediaPlayback(): Promise<void> {
  pauseNonCurrentMedia()
  await nextTick()
  playCurrentMedia()
}

function handleUserGesture(e: Event): void {
  hasUserInteracted.value = true

  const target = e.target
  if (target instanceof Element && target.closest('video, audio, button, input, a'))
    return

  playCurrentMedia()
}

function getPanelClass(slotIdx: number): string {
  const offset = (slotIdx - props.currentSlot + 3) % 3
  if (offset === 0)
    return 'swipe-panel--current'
  if (offset === 1)
    return 'swipe-panel--next'
  return 'swipe-panel--prev'
}

function isPanelImageLoaded(slotIdx: number, panelItem: MediaFile): boolean {
  return props.panelLoadedUrls[slotIdx] === panelItem.url
}

function isPanelImageLoading(slotIdx: number, panelItem: MediaFile): boolean {
  return slotIdx === props.currentSlot && !isPanelImageLoaded(slotIdx, panelItem)
}

function getPanelImageStyle(slotIdx: number, panelItem: MediaFile): CSSProperties {
  const style: CSSProperties = slotIdx === props.currentSlot ? props.currentImageStyle : {}
  if (isPanelImageLoaded(slotIdx, panelItem))
    return style

  return {
    ...style,
    visibility: 'hidden',
  }
}

function onImageLoad(e: Event, slotIdx: number): void {
  emit('imageLoad', e, slotIdx)

  const img = e.target
  if (slotIdx === props.currentSlot && img instanceof HTMLImageElement)
    emit('currentImageReady', img)
}

async function emitCurrentImageIfReady(): Promise<void> {
  await nextTick()

  const panelItem = props.panelItems[props.currentSlot]
  if (panelItem?.type !== 'image')
    return

  const img = imageRefs.value[props.currentSlot]
  if (img?.complete && img.naturalWidth)
    emit('currentImageReady', img)
}

watch(
  () => [
    props.currentSlot,
    props.panelItems.map(item => item?.url ?? '').join('|'),
  ],
  () => {
    void emitCurrentImageIfReady()
    void syncMediaPlayback()
  },
  { immediate: true },
)

onMounted(() => {
  emit('containerReady', containerRef.value)
  window.addEventListener('pointerdown', handleUserGesture)
  window.addEventListener('keydown', handleUserGesture)
  void syncMediaPlayback()
})

onBeforeUnmount(() => {
  emit('containerReady', null)
  window.removeEventListener('pointerdown', handleUserGesture)
  window.removeEventListener('keydown', handleUserGesture)
})
</script>

<template>
  <div ref="containerRef" class="swipe-container" :style="containerStyle">
    <div
      v-for="(panelItem, slotIndex) in panelItems"
      :key="slotIndex"
      class="swipe-panel"
      :class="getPanelClass(slotIndex)"
    >
      <template v-if="panelItem">
        <template v-if="panelItem.type === 'image'">
          <img
            :ref="(el) => setImageRef(el, slotIndex)"
            :src="panelItem.url"
            class="media-fit"
            :style="getPanelImageStyle(slotIndex, panelItem)"
            draggable="false"
            @load="onImageLoad($event, slotIndex)"
          >
          <div
            v-if="isPanelImageLoading(slotIndex, panelItem)"
            class="image-loading-placeholder"
          >
            <span class="mdi mdi-loading" />
          </div>
        </template>
        <video
          v-else-if="panelItem.type === 'video'"
          :ref="(el) => setMediaRef(el, slotIndex)"
          :key="panelItem.url"
          :src="panelItem.url"
          class="media-fit"
          :controls="slotIndex === currentSlot"
          :autoplay="slotIndex === currentSlot"
          :muted="!hasUserInteracted"
          :tabindex="slotIndex === currentSlot ? 0 : -1"
          loop
          playsinline
          webkit-playsinline
        />
        <div v-else class="audio-pane">
          <span class="mdi mdi-music-circle-outline audio-bg-icon" />
          <audio
            v-if="panelItem.type === 'audio' && slotIndex === currentSlot"
            :ref="(el) => setMediaRef(el, slotIndex)"
            :key="panelItem.url"
            :src="panelItem.url"
            controls
            autoplay
            class="audio-ctrl"
            loop
            playsinline
            webkit-playsinline
            :muted="!hasUserInteracted"
            :tabindex="slotIndex === currentSlot ? 0 : -1"
          />
        </div>
      </template>
      <div v-else class="boundary-hint">
        <span
          class="mdi"
          :class="getPanelClass(slotIndex) === 'swipe-panel--prev' ? 'mdi-ray-start' : 'mdi-ray-end'"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.swipe-container {
  position: absolute;
  inset: 0;
  // Promote to GPU compositing layer so the browser can animate transform
  // without triggering a repaint of the panels' contents.
  will-change: transform;
}

.swipe-panel {
  position: absolute;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  // Isolate each panel's layout/paint to reduce repaint work while swiping.
  contain: layout style paint;

  &--prev { bottom: 100%; top: auto; }
  &--current { top: 0; }
  &--next { top: 100%; }

  &--current {
    cursor: default;
    video, audio, button { cursor: auto; }
  }
}

.media-fit {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.swipe-panel--current .media-fit {
  pointer-events: auto;
}

.image-loading-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  color: rgba(255, 255, 255, 0.35);
  pointer-events: none;

  .mdi {
    animation: image-loading-spin 0.9s linear infinite;
  }
}

@keyframes image-loading-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

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

.boundary-hint {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  color: rgba(255, 255, 255, 0.1);
}
</style>
