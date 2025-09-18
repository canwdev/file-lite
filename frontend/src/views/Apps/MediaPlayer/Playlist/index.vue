<script setup lang="ts">
import PlaylistItem from '../Playlist/PlaylistItem.vue'
import {MediaItem} from '../utils/music-state'
import {IEntry} from '@server/types/server'
import {isSupportedMediaFormat} from '@/utils/is'
import {MusicEvents, useMediaStore} from '../utils/media-store'

const storeId = inject('storeId')
const mediaStore = useMediaStore(storeId.value)
const filterText = ref('')

const handleItemClick = (item: MediaItem) => {
  const idx = mediaStore.playingList.findIndex((i) => i.guid === item.guid)
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

  const reg = new RegExp(filterText.value, 'ig')
  return mediaStore.playingList.filter((item) => {
    const title = item.titleDisplay
    return reg.test(item.titleDisplay) || reg.test(item.artistsAlbumDisplay)
  })
})

const handleSelect = (data) => {
  const items = data.items as IEntry[] | undefined
  const basePath = data.basePath as string
  console.log('[handleSelect]', data)
  if (!items) {
    return
  }

  const medias = items
    .map((i) => new MediaItem(i.name, basePath))
    .filter((i) => {
      return isSupportedMediaFormat(i.filename)
    })

  mediaStore.playFromList(medias, 0)
}
</script>

<template>
  <div class="music-play-list">
    <div class="vgo-bg playlist-action-bar">
      <input class="vgo-input" :placeholder="`Filter by name`" v-model="filterText" />

      <span class="number-display"
        >{{ mediaStore.playingIndex + 1 }} / {{ mediaStore.playingList.length }}</span
      >
    </div>
    <!--<div class="flex-row-center-gap media-open-actions" v-if="!mediaStore.playingList.length">-->
    <!--  <FileSelector select-file-mode="file" multiple @handleSelect="handleSelect" />-->
    <!--</div>-->
    <div class="music-list">
      <PlaylistItem
        v-for="item in playlistFiltered"
        :key="item.guid"
        :item="item"
        @click="handleItemClick(item)"
      ></PlaylistItem>
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
