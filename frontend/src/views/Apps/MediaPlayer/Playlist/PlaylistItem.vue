<script setup lang="ts">
import type { MediaItem } from '../utils/music-state'
import CoverMini from '../CoverMini.vue'
import { useMediaStore } from '../utils/media-store'

interface Props {
  item: MediaItem
}
const props = withDefaults(defineProps<Props>(), {})
const storeId = inject<Ref<string>>('storeId')!
const mediaStore = useMediaStore(storeId.value)

const { item } = toRefs(props)
const isCurrent = computed(() => {
  return item.value.guid === mediaStore.mediaItem?.guid
})
</script>

<template>
  <div class="playlist-item" :class="{ active: isCurrent }">
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
    <div class="item-right" />
  </div>
</template>

<style lang="scss" scoped>
.playlist-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  word-break: break-word;
  border: 1px solid transparent;
  background-color: transparent;
  transition: background-color 0.12s ease;

  &:hover {
    background-color: var(--el-fill-color-light, rgba(128, 128, 128, 0.12));
  }

  &.active {
    background-color: var(--vgo-primary-opacity);
  }

  .item-left {
    display: inline-flex;
    flex-shrink: 0;
    position: relative;

    /* Finder 式小图标，仅列表内缩小 */
    :deep(.btn-cover) {
      width: 28px;
      height: 28px;
      border-radius: 4px;
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
      left: -4px;
      top: -6px;
      font-size: 10px;
      line-height: 1;
      padding: 1px 2px;
      border-radius: 2px;
      background: rgba(0, 0, 0, 0.404);
      color: #fff;
    }
  }

  .item-main {
    flex: 1;
    min-width: 0;
    padding: 2px 0;

    .item-title {
      font-size: 13px;
      font-weight: 500;
      line-height: 1.28;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    &.has-subtitle .item-title {
      -webkit-line-clamp: 1;
    }

    &:not(.has-subtitle) .item-title {
      -webkit-line-clamp: 2;
    }

    .item-subtitle {
      margin-top: 1px;
      font-size: 11px;
      font-weight: 400;
      line-height: 1.25;
      color: var(--el-text-color-secondary, inherit);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
      word-break: break-word;
    }
  }
}
</style>
