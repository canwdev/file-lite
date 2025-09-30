<script setup lang="ts">
import type { MediaItem } from '../utils/music-state'
import PlaylistItem from '../Playlist/PlaylistItem.vue'
import { MusicEvents, useMediaStore } from '../utils/media-store'

const storeId = inject('storeId')
const mediaStore = useMediaStore(storeId.value)
const filterText = ref('')

function handleItemClick(item: MediaItem) {
  const idx = mediaStore.playingList.findIndex(i => i.guid === item.guid)
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
  if (!filterText.value) {
    return mediaStore.playingList
  }

  const reg = new RegExp(filterText.value, 'gi')
  return mediaStore.playingList.filter((item) => {
    return reg.test(item.titleDisplay) || reg.test(item.artistsAlbumDisplay)
  })
})
</script>

<template>
  <div class="music-play-list">
    <div class="vgo-bg playlist-action-bar">
      <input v-model="filterText" class="vgo-input" placeholder="Filter by name">

      <span class="number-display">{{ mediaStore.playingIndex + 1 }} / {{ mediaStore.playingList.length }}</span>
    </div>
    <div class="music-list">
      <PlaylistItem
        v-for="item in playlistFiltered"
        :key="item.guid"
        :item="item"
        @click="handleItemClick(item)"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.music-play-list {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  position: relative;

  .playlist-action-bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 4px;
    border-bottom: 1px solid var(--vgo-color-border);
  }

  .media-open-actions {
    padding: 8px;
  }
}
</style>
