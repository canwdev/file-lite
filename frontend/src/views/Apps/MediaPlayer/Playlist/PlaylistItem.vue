<script setup lang="ts">
import type { MediaItem } from '../utils/music-state'
import CoverMini from '../CoverMini.vue'
import { useMediaStore } from '../utils/media-store'

interface Props {
  item: MediaItem
}
const props = withDefaults(defineProps<Props>(), {})
const emit = defineEmits<{
  (e: 'locateItem', name: string): void
}>()
const storeId = inject<Ref<string>>('storeId')!
const mediaStore = useMediaStore(storeId.value)

const { item } = toRefs(props)
const isCurrent = computed(() => {
  return item.value.guid === mediaStore.mediaItem?.guid
})
</script>

<template>
  <div class="playlist-item" :class="{ active: isCurrent }" :title="item.filename">
    <div class="item-left">
      <div v-if="isCurrent" class="status-icon">
        <template v-if="!mediaStore.paused">
          <span class="mdi mdi-play" />
        </template>
        <template v-else>
          <span class="mdi mdi-pause" />
        </template>
      </div>
      <CoverMini :src="item.cover" :is-video="item.type === 'video'" />
    </div>
    <div class="item-main" :class="{ 'has-subtitle': !!item.artistsAlbumDisplay }">
      <div class="item-title">
        {{ item.titleDisplay }}
      </div>
      <div v-if="item.artistsAlbumDisplay" class="item-subtitle">
        {{ item.artistsAlbumDisplay }}
      </div>
    </div>
    <div class="item-right">
      <button
        class="locate-btn btn-no-style"
        title="Locate in folder"
        @click.stop="emit('locateItem', item.filename)"
      >
        <span class="mdi mdi-crosshairs-gps" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.playlist-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 52px;
  padding: 7px 10px 7px 7px;
  border-radius: 14px;
  cursor: pointer;
  word-break: break-word;
  border: 1px solid transparent;
  background-color: transparent;
  position: relative;
  transition: background-color 0.14s ease, border-color 0.14s ease, transform 0.14s ease;

  &:hover {
    background-color: rgba(255, 255, 255, 0.56);
  }

  &.active {
    border-color: rgba(var(--vgo-primary-rgb), 0.3);
    background:
      linear-gradient(135deg, rgba(var(--vgo-primary-rgb), 0.18), rgba(255, 45, 85, 0.10)),
      rgba(255, 255, 255, 0.64);
  }

  .item-left {
    display: inline-flex;
    flex-shrink: 0;
    position: relative;

    /* Finder 式小图标，仅列表内缩小 */
    :deep(.btn-cover) {
      width: 38px;
      height: 38px;
      border-radius: 10px;
    }

    :deep(.icon-wrap) {
      font-size: 16px;
    }

    :deep(.cover-type-badge) {
      width: 14px;
      height: 14px;
      right: 1px;
      bottom: 1px;

      .badge-icon {
        font-size: 10px;
      }
    }

    .status-icon {
      position: absolute;
      z-index: 1;
      left: -3px;
      top: -3px;
      font-size: 9px;
      line-height: 1;
      padding: 2px 3px;
      border-radius: 999px;
      background: rgba(var(--vgo-primary-rgb), 0.86);
      color: #fff;
      box-shadow: 0 2px 8px rgba(var(--vgo-primary-rgb), 0.3);
    }
  }

  .item-main {
    flex: 1;
    min-width: 0;
    padding: 1px 28px 1px 0;

    .item-title {
      font-size: 13px;
      font-weight: 650;
      line-height: 1.28;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    &.has-subtitle .item-title {
      line-clamp: 1;
      -webkit-line-clamp: 1;
    }

    &:not(.has-subtitle) .item-title {
      line-clamp: 2;
      -webkit-line-clamp: 2;
    }

    .item-subtitle {
      margin-top: 3px;
      font-size: 11px;
      font-weight: 400;
      line-height: 1.25;
      color: var(--el-text-color-secondary, inherit);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      line-clamp: 1;
      -webkit-line-clamp: 1;
      overflow: hidden;
      word-break: break-word;
    }
  }

  .item-right {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    opacity: 0;
    transition: opacity 0.12s ease;
    pointer-events: none;

    .locate-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      color: inherit;
      background-color: rgba(255, 255, 255, 0.68);
      backdrop-filter: blur(10px);
      pointer-events: auto;

      &:hover {
        background-color: var(--vgo-primary-opacity);
      }
    }
  }

  &:hover .item-right {
    opacity: 1;
  }
}

:global(.dark) {
  .playlist-item {
    &:hover {
      background-color: rgba(255, 255, 255, 0.075);
    }

    &.active {
      background:
        linear-gradient(135deg, rgba(var(--vgo-primary-rgb), 0.22), rgba(255, 45, 85, 0.12)),
        rgba(255, 255, 255, 0.08);
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.12);
    }

    .item-right .locate-btn {
      background-color: rgba(255, 255, 255, 0.14);
    }
  }
}
</style>
