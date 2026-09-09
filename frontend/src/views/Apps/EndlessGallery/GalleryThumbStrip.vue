<script lang="ts" setup>
import type { MediaFile } from './use-media-list.ts'
import { getFileIconClass } from '@/views/FileManager/ExplorerUI/file-icons'
import ThemedIcon from '@/views/FileManager/ExplorerUI/ThemedIcon.vue'
import { useThumbStrip } from './use-thumb-strip.ts'

const props = defineProps<{
  items: MediaFile[]
  currentIndex: number
  basePath: string
}>()

const emit = defineEmits<{
  (e: 'select', index: number): void
}>()

/**
 * 缩略图尺寸。ThemedIcon 小于 48px 时只显示类型图标（MIN_PREVIEW_ICON_SIZE），
 * 所以这里不能更小；EndlessGallery.vue 的 --gallery-thumb-strip-height 需与之对应。
 */
const THUMB_ICON_SIZE = 48

const itemsRef = computed(() => props.items)
const currentIndexRef = computed(() => props.currentIndex)
const { trackRef, progressWidth, onTrackWheel, onTrackTouchStart } = useThumbStrip({
  items: itemsRef,
  currentIndex: currentIndexRef,
})
</script>

<template>
  <!-- 贴底半透明浮层：--flat 去掉圆角/边框/阴影，--overlay 提供半透明底与统一模糊 -->
  <div class="thumb-strip vgo-panel vgo-panel--flat vgo-panel--overlay">
    <!-- 进度层：半透明主题色背景，宽度 = 当前下标 / 总数；在缩略图之下，与原生滚动条共存 -->
    <div class="thumb-strip__progress" :style="{ width: progressWidth }" />

    <div
      ref="trackRef"
      class="thumb-strip__track vgo-u-scrollbar"
      @wheel.stop.prevent="onTrackWheel"
      @mousedown.stop
      @touchstart.stop="onTrackTouchStart"
    >
      <button
        v-for="(item, index) in items"
        :key="item.name"
        class="vgo-u-button-reset vgo-list-item thumb-strip__cell"
        :class="{ 'is-active': index === currentIndex }"
        :title="item.name"
        :aria-label="item.name"
        :aria-current="index === currentIndex ? 'true' : undefined"
        @click.stop="emit('select', index)"
      >
        <ThemedIcon
          :icon-class="getFileIconClass(item.entry)"
          :item="item.entry"
          :abs-path="`${basePath}/${item.name}`"
          :icon-size="THUMB_ICON_SIZE"
        />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.thumb-strip {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}

.thumb-strip__progress {
  position: absolute;
  inset: 0 auto 0 0;
  background-color: var(--vgo-primary-opacity);
  transition: width var(--vgo-duration-base);
  pointer-events: none;
}

.thumb-strip__track {
  // 定位上下文：格子的 offsetLeft 必须相对轨道计算（见 use-thumb-strip）；
  // 同时它排在进度层之后，缩略图与滚动条都画在进度层之上。
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--vgo-space-1);
  padding: var(--vgo-space-1) var(--vgo-space-2);
  overflow-x: auto;
  overflow-y: hidden;
  touch-action: pan-x;
  overscroll-behavior-x: contain;
}

// 选中 / 悬停配色由 .vgo-list-item 的 is-active / :hover 给出（浮层内自动转成浮层配色），
// 这里只覆盖列表项默认的横向内边距与最小高度，让格子紧贴缩略图。
.thumb-strip__cell {
  flex: 0 0 auto;
  gap: 0;
  min-height: 0;
  padding: var(--vgo-space-1);
  border-radius: var(--vgo-radius);
  line-height: 1;

  // 缩略图不参与原生图片拖拽，否则拖动条时会拖出图片幽灵而不是滚动
  :deep(img) {
    -webkit-user-drag: none;
  }
}
</style>
