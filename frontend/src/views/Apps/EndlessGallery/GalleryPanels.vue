<script lang="ts" setup>
import type { ComponentPublicInstance, CSSProperties } from 'vue'
import type { MediaFile } from './use-media-list.ts'
import GalleryMedia from './GalleryMedia.vue'

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

function setImageRef(el: Element | ComponentPublicInstance | null, slotIdx: number): void {
  imageRefs.value[slotIdx] = el instanceof HTMLImageElement ? el : null
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
  },
  { immediate: true },
)

onMounted(() => {
  emit('containerReady', containerRef.value)
})

onBeforeUnmount(() => {
  emit('containerReady', null)
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
            <i-mdi-loading />
          </div>
        </template>
        <GalleryMedia
          v-else
          :item="panelItem"
          :active="slotIndex === currentSlot"
        />
      </template>
      <div v-else class="boundary-hint">
        <MdiIcon
          :name="getPanelClass(slotIndex) === 'swipe-panel--prev' ? 'ray-start' : 'ray-end'"
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
}

// 只用于图片：音视频的尺寸与指针事件由 GalleryMedia 自己管
.media-fit {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
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

  > svg {
    animation: image-loading-spin 0.9s linear infinite;
  }
}

@keyframes image-loading-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
