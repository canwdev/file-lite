<script setup lang="ts">
import type { MediaItem } from '../utils/music-state'
import { refDebounced } from '@vueuse/core'
import { MusicEvents, useMediaStore } from '../utils/media-store'
import PlaylistItem from './PlaylistItem.vue'

const storeId = inject<Ref<string>>('storeId')!
const mediaStore = useMediaStore(storeId.value)
const emit = defineEmits<{
  (e: 'locateItem', name: string): void
}>()

const filterText = ref('')
const filterTextDebounced = refDebounced(filterText, 500)

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function handleItemClick(item: MediaItem) {
  const idx = mediaStore.playingList.findIndex((i: MediaItem) => i.guid === item.guid)
  if (idx === -1) {
    console.error('idx not found!')
    return
  }
  if (idx === mediaStore.playingIndex) {
    mediaStore.mediaBus.emit(MusicEvents.ACTION_TOGGLE_PLAY)
    return
  }
  mediaStore.playByIndex(idx)
}

const playlistFiltered = computed(() => {
  if (!filterTextDebounced.value.trim()) {
    return mediaStore.playingList
  }

  const reg = new RegExp(escapeRegExp(filterTextDebounced.value.trim()), 'gi')
  return mediaStore.playingList.filter((item: MediaItem) => {
    return reg.test(item.titleDisplay) || reg.test(item.artistsAlbumDisplay ?? '')
  })
})

const isPlaylistEmpty = computed(() => mediaStore.playingList.length === 0)
const isFilterEmpty = computed(
  () => !!filterTextDebounced.value.trim() && playlistFiltered.value.length === 0,
)

const listRef = ref<HTMLElement>()

function scrollToCurrent() {
  const el = listRef.value?.querySelector('.playlist-item.active')
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
</script>

<template>
  <div class="music-play-list">
    <div class="vgo-bg playlist-action-bar">
      <input v-model="filterText" class="vgo-input" :placeholder="`Filter by name, ${mediaStore.playingIndex + 1}/${mediaStore.playingList.length} items`">
      <button class="btn-no-style mdi mdi-crosshairs-gps" @click="scrollToCurrent" />
    </div>
    <div ref="listRef" class="music-list">
      <template v-if="isPlaylistEmpty">
        <div class="playlist-empty">
          No media in this list
        </div>
      </template>
      <template v-else-if="isFilterEmpty">
        <div class="playlist-empty">
          No matches for filter
        </div>
      </template>
      <template v-else>
        <PlaylistItem
          v-for="item in playlistFiltered"
          :key="item.guid"
          :item="item"
          @click="handleItemClick(item)"
          @locate-item="(name: string) => emit('locateItem', name)"
        />
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.music-play-list {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  position: relative;

  .playlist-action-bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    padding: 3px 4px;
    border-bottom: 1px solid var(--vgo-color-border);

    .vgo-input {
      flex: 1;
    }
  }

  .number-display {
    flex-shrink: 0;
    color: var(--el-text-color-secondary, inherit);
    white-space: nowrap;
  }

  .music-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 4px;
  }

  .playlist-empty {
    padding: 16px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--el-text-color-secondary, inherit);
  }

  .media-open-actions {
    padding: 8px;
  }
}
</style>
