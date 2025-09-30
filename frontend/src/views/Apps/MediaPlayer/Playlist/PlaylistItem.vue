<script setup lang="ts">
import type { MediaItem } from '../utils/music-state'
import CoverMini from '../CoverMini.vue'
import { useMediaStore } from '../utils/media-store'

interface Props {
  item: MediaItem
}
const props = withDefaults(defineProps<Props>(), {})
const storeId = inject('storeId')
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
      <CoverMini :src="item.cover" force-show-icon :is-video="item.type === 'video'" />
    </div>
    <div class="item-main">
      <div class="item-title">
        {{ item.titleDisplay }}
      </div>
      <div class="item-subtitle">
        {{ item.artistsAlbumDisplay }}
      </div>
    </div>
    <div class="item-right" />
  </div>
</template>

<style lang="scss" scoped>
.playlist-item {
  padding: 4px;
  word-break: break-word;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  border-radius: 4px;

  &:nth-child(2n) {
    background-color: rgba(134, 134, 134, 0.1);
  }
  &:hover {
    background-color: var(--vgo-primary-opacity);
  }
  &.active {
    background-color: var(--vgo-primary-opacity);
    outline: 1px solid var(--vgo-primary);
    outline-offset: -1px;
  }

  .item-left {
    display: inline-flex;
    position: relative;
    .status-icon {
      position: absolute;
      z-index: 1;
      font-size: 14px;
    }
  }

  .item-main {
    flex: 1;
    .item-title {
      font-size: 14px;
      font-weight: 500;
    }
    .item-subtitle {
      font-size: 12px;
      font-weight: 400;
    }
  }
}
</style>
