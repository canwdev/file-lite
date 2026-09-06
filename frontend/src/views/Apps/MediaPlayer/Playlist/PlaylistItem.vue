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
  <div class="vgo-list-item playlist-item" :class="{ 'is-active': isCurrent }" :title="item.filename">
    <div class="item-left">
      <div v-if="isCurrent" class="status-icon">
        <template v-if="!mediaStore.paused">
          <i-mdi-play />
        </template>
        <template v-else>
          <i-mdi-pause />
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
        class="vgo-button vgo-button--round vgo-button--icon vgo-button--sm"
        title="Locate in folder"
        @click.stop="emit('locateItem', item.filename)"
      >
        <i-mdi-crosshairs-gps />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.playlist-item {
  min-height: 52px;
  border-radius: var(--vgo-radius-lg);
  word-break: break-word;
  position: relative;

  .item-left {
    display: inline-flex;
    flex-shrink: 0;
    position: relative;

    // Finder 式小图标，仅列表内缩小
    :deep(.btn-cover) {
      width: 38px;
      height: 38px;
    }

    :deep(.icon-wrap) {
      font-size: var(--vgo-icon-sm);
    }

    .status-icon {
      position: absolute;
      z-index: 1;
      left: -3px;
      top: -3px;
      font-size: 9px;
      line-height: 1;
      padding: 2px 3px;
      border-radius: var(--vgo-radius-pill);
      background-color: var(--vgo-primary);
      color: var(--vgo-on-primary);
    }
  }

  .item-main {
    flex: 1;
    min-width: 0;

    .item-title {
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
      font-size: var(--vgo-font-sm);
      line-height: 1.25;
      color: var(--vgo-text-secondary);
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
    right: var(--vgo-space-2);
    top: 50%;
    transform: translateY(-50%);
    opacity: 0;
    transition: opacity var(--vgo-duration-fast) ease;
    pointer-events: none;

    .vgo-button {
      pointer-events: auto;
    }
  }

  &:hover .item-right {
    opacity: 1;
  }
}
</style>
