<script lang="ts" setup>
import type { MediaFile } from './use-media-list.ts'
import { getFileIconClass } from '@/views/FileManager/ExplorerUI/file-icons'
import { useMediaElement } from './use-media-element.ts'

const props = defineProps<{
  item: MediaFile
  /** 是否是当前槽位：false 时卸载媒体元素（连带 src），只留类型图标占位 */
  active: boolean
}>()

const {
  elRef,
  seekBarRef,
  muted,
  isReady,
  isPlaying,
  isScrubbing,
  displayPercent,
  onLoadedMetadata,
  onTimeUpdate,
  onPlay,
  onPause,
  toggleMute,
  onSurfacePointerDown,
  onSurfacePointerUp,
  onSeekPointerDown,
  onSeekPointerMove,
  onSeekPointerUp,
} = useMediaElement({
  item: () => props.item,
  active: () => props.active,
})

const isVideo = computed(() => props.item.type === 'video')
const isAudio = computed(() => props.item.type === 'audio')
/** 暂停且已就绪才显示中央播放图标（加载中不闪图标） */
const showPlayIcon = computed(() => props.active && isReady.value && !isPlaying.value)
</script>

<template>
  <div class="gallery-media">
    <!-- 点击面：覆盖整个舞台，媒体元素与占位图标都不接收指针事件 -->
    <div
      class="gallery-media__surface"
      @pointerdown="onSurfacePointerDown"
      @pointerup="onSurfacePointerUp"
      @pointercancel="onSurfacePointerUp"
    >
      <template v-if="active">
        <video
          v-if="isVideo"
          :key="item.url"
          ref="elRef"
          :src="item.url"
          class="gallery-media__el"
          :muted="muted"
          loop
          playsinline
          webkit-playsinline
          preload="metadata"
          @loadedmetadata="onLoadedMetadata"
          @timeupdate="onTimeUpdate"
          @play="onPlay"
          @pause="onPause"
        />
        <audio
          v-else-if="isAudio"
          :key="item.url"
          ref="elRef"
          :src="item.url"
          class="gallery-media__el gallery-media__el--audio"
          :muted="muted"
          loop
          preload="metadata"
          @loadedmetadata="onLoadedMetadata"
          @timeupdate="onTimeUpdate"
          @play="onPlay"
          @pause="onPause"
        />
        <i-mdi-music-circle-outline v-if="isAudio" class="gallery-media__audio-bg" />
      </template>

      <div v-else class="gallery-media__placeholder">
        <MdiIcon :name="getFileIconClass(item.entry)" />
      </div>
    </div>

    <div v-if="showPlayIcon" class="gallery-media__play-icon">
      <i-mdi-play />
    </div>

    <div v-if="active" class="gallery-media__controls">
      <button
        class="vgo-button vgo-button--overlay vgo-button--icon vgo-button--round vgo-button--sm gallery-media__mute"
        :class="{ 'is-muted': muted }"
        :title="muted ? 'Unmute' : 'Mute'"
        @click.stop="toggleMute"
      >
        <MdiIcon :name="muted ? 'volume-variant-off' : 'volume-high'" />
      </button>

      <div
        ref="seekBarRef"
        class="gallery-media__seek"
        data-no-swipe
        @pointerdown="onSeekPointerDown"
        @pointermove="onSeekPointerMove"
        @pointerup="onSeekPointerUp"
        @pointercancel="onSeekPointerUp"
        @mousedown.stop
        @touchstart.stop
      >
        <div class="vgo-progress" :style="{ '--vgo-progress-height': '3px' }">
          <div
            class="vgo-progress__value"
            :style="{ width: displayPercent, transition: isScrubbing ? 'none' : undefined }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.gallery-media {
  position: absolute;
  inset: 0;
}

.gallery-media__surface {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gallery-media__el {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  // 点击统一由 surface 处理，也避免原生控件/手势抢走翻页拖拽
  pointer-events: none;
}

.gallery-media__el--audio {
  display: none;
}

.gallery-media__audio-bg {
  font-size: 120px;
  color: var(--vgo-overlay-control);
  pointer-events: none;
}

.gallery-media__placeholder {
  font-size: 48px;
  color: var(--vgo-overlay-control-active);
  pointer-events: none;
}

.gallery-media__play-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--vgo-icon-lg) * 2.5);
  color: var(--vgo-overlay-text);
  opacity: 0.75;
  pointer-events: none;
}

// 与缩略图条、收藏按钮同一层：贴底缩略图条之上
.gallery-media__controls {
  position: absolute;
  left: var(--vgo-space-2);
  right: var(--vgo-space-2);
  bottom: calc(var(--gallery-thumb-strip-height));
  display: flex;
  align-items: center;
  gap: var(--vgo-space-2);
}

// 常显：静音状态是随时可切的操作，不跟随悬停
.gallery-media__mute {
  opacity: 1;
}

.gallery-media__seek {
  flex: 1;
  min-width: 0;
  // 轨道只有 3px，用内边距把命中区撑到可拖
  padding: var(--vgo-space-1) 0;
  cursor: pointer;
  touch-action: none;
}
</style>
